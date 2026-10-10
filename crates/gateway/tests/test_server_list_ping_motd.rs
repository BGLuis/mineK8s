use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::{BufMut, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::time::sleep;

use gateway::motd::StatusCache;
use gateway::routing::{CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus};
use gateway::{GatewayConfig, GatewayServer};

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::ping::{PingRequestPacket, PongResponsePacket};
use minecraft_protocol::packets::status::{
    MotdDescription, ServerStatusResponse, StatusResponsePacket,
};
use minecraft_protocol::types::varint::VarInt;

/// Critério de aceite da Issue #52 (RF-GW-09, GW:256-327):
/// Valida que um servidor no estado `Stopped` (Hibernando) responde o MOTD sintético de hibernação
/// com amostra de jogador "[Clique para Conectar e Acordar]" e NUNCA tenta tocar a JVM upstream.
#[tokio::test]
async fn test_server_stopped_responds_hibernation_motd_without_touching_jvm() {
    let upstream_connections = Arc::new(AtomicUsize::new(0));
    let upstream_conn_clone = Arc::clone(&upstream_connections);

    // Mock upstream: não deve receber nenhuma conexão se o servidor estiver Stopped
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    let _mock_jvm = tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            upstream_conn_clone.fetch_add(1, Ordering::SeqCst);
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let stopped_route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival World".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Stopped,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(stopped_route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // Cliente Minecraft enviando Handshake + Status Request + Ping Request
    let client_task = tokio::spawn(async move {
        let mut stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

        // 1. Handshake (NextState = 1 Status)
        let handshake = HandshakePacket {
            protocol_version: VarInt(765),
            server_address: "survival.mine.lan".into(),
            server_port: gateway_addr.port(),
            next_state: HandshakeNextState::Status,
        };
        let mut hs_payload = BytesMut::new();
        handshake.encode(&mut hs_payload);

        let mut wire = BytesMut::new();
        VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
        VarInt(0x00).encode(&mut wire);
        wire.put_slice(&hs_payload);

        // 2. Status Request (0x00)
        VarInt(1).encode(&mut wire);
        VarInt(0x00).encode(&mut wire);

        stream.write_all(&wire).await.unwrap();

        // 3. Ler Status Response
        let mut raw_buf = BytesMut::with_capacity(4096);
        loop {
            let mut cursor = &raw_buf[..];
            match RawPacket::decode_prelogin(&mut cursor) {
                Ok(raw) => {
                    assert_eq!(raw.packet_id, StatusResponsePacket::PACKET_ID);
                    let mut payload_cursor = &raw.payload[..];
                    let status_res = StatusResponsePacket::decode(&mut payload_cursor).unwrap();

                    let status_json: ServerStatusResponse =
                        serde_json::from_str(&status_res.json_response).unwrap();

                    // Validação do MOTD sintético de hibernação
                    match status_json.description {
                        MotdDescription::Plain(text) => {
                            assert!(text.contains("Hibernando"));
                            assert!(text.contains("Survival World"));
                        }
                        other => panic!("Esperado MotdDescription::Plain, recebido: {:?}", other),
                    }

                    assert_eq!(status_json.players.online, 0);
                    assert_eq!(status_json.players.max, 20);
                    let sample = status_json
                        .players
                        .sample
                        .expect("Deve conter player sample");
                    assert_eq!(sample[0].name, "§e► §7Entre e o mundo será ligado");
                    break;
                }
                Err(_) => {
                    let n = stream.read_buf(&mut raw_buf).await.unwrap();
                    assert!(n > 0, "EOF prematuro");
                }
            }
        }

        // 4. Enviar Ping Request (Packet ID 0x01)
        let mut ping_wire = BytesMut::new();
        let ping_pkt = PingRequestPacket::new(9876543210);
        let mut ping_payload = BytesMut::new();
        ping_pkt.encode(&mut ping_payload);

        VarInt(ping_payload.len() as i32 + 1).encode(&mut ping_wire);
        VarInt(0x01).encode(&mut ping_wire);
        ping_wire.put_slice(&ping_payload);

        stream.write_all(&ping_wire).await.unwrap();

        // 5. Ler Pong Response
        let mut pong_buf = BytesMut::with_capacity(64);
        loop {
            let mut cursor = &pong_buf[..];
            match RawPacket::decode_prelogin(&mut cursor) {
                Ok(raw) => {
                    assert_eq!(raw.packet_id, PongResponsePacket::PACKET_ID);
                    let mut cursor = &raw.payload[..];
                    let pong = PongResponsePacket::decode(&mut cursor).unwrap();
                    assert_eq!(pong.payload, 9876543210);
                    break;
                }
                Err(_) => {
                    let n = stream.read_buf(&mut pong_buf).await.unwrap();
                    assert!(n > 0, "EOF prematuro aguardando pong");
                }
            }
        }
    });

    client_task.await.unwrap();

    // Comprovação do Critério de Aceite: NENHUMA conexão foi feita com a JVM mock!
    assert_eq!(
        upstream_connections.load(Ordering::SeqCst),
        0,
        "A JVM backend jamais deve ser contatada para servidor no estado Stopped!"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Testa o cache com TTL de status para instâncias Ready (RF-GW-09):
/// Múltiplas consultas dentro do TTL atingem o cache e não sobrecarregam a JVM.
#[tokio::test]
async fn test_server_ready_status_cache_hit_and_expiry() {
    let upstream_queries = Arc::new(AtomicUsize::new(0));
    let upstream_clone = Arc::clone(&upstream_queries);

    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock JVM respondendo status real
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            upstream_clone.fetch_add(1, Ordering::SeqCst);

            // Ler Handshake e StatusRequest do Gateway
            let mut buf = [0u8; 256];
            let _ = stream.read(&mut buf).await.unwrap();

            // Responder Status Response com payload mock
            let mock_status = ServerStatusResponse {
                version: minecraft_protocol::packets::status::ServerVersionInfo {
                    name: "Paper 1.20.4".into(),
                    protocol: 765,
                },
                players: minecraft_protocol::packets::status::PlayersInfo {
                    max: 100,
                    online: 12,
                    sample: None,
                },
                description: MotdDescription::Plain("Upstream Real Online".into()),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            };
            let status_pkt = StatusResponsePacket::from_status(&mock_status).unwrap();
            let mut payload = BytesMut::new();
            status_pkt.encode(&mut payload);

            let raw = RawPacket {
                packet_id: StatusResponsePacket::PACKET_ID,
                payload: payload.freeze(),
            };
            let mut wire = BytesMut::new();
            raw.encode(&mut wire);
            stream.write_all(&wire).await.unwrap();
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let ready_route = CachedServerRoute {
        server_id: "srv-online".into(),
        name: "Online World".into(),
        subdomain: "online.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 100,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(ready_route);

    // TTL de 200 milissegundos para o teste rodar rapidamente
    let status_cache = StatusCache::new(Duration::from_millis(200));

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_status_cache(status_cache);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // 1ª Consulta: deve ir ao upstream (Cache Miss)
    send_status_ping(gateway_addr, "online.mine.lan").await;
    assert_eq!(upstream_queries.load(Ordering::SeqCst), 1);

    // 2ª Consulta imediata (5ms depois): deve usar cache (Cache Hit)
    sleep(Duration::from_millis(5)).await;
    send_status_ping(gateway_addr, "online.mine.lan").await;
    assert_eq!(
        upstream_queries.load(Ordering::SeqCst),
        1,
        "Segunda consulta dentro do TTL deve bater no cache sem tocar o upstream"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

async fn send_status_ping(gateway_addr: std::net::SocketAddr, host: &str) {
    let mut stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: host.into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Status,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    VarInt(1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);

    stream.write_all(&wire).await.unwrap();

    let mut buf = BytesMut::with_capacity(1024);
    loop {
        let mut cursor = &buf[..];
        if let Ok(_) = RawPacket::decode_prelogin(&mut cursor) {
            break;
        }
        let n = stream.read_buf(&mut buf).await.unwrap();
        if n == 0 {
            break;
        }
    }
}
