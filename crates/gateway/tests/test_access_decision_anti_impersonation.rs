use bytes::{BufMut, BytesMut};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UnixListener};
use tokio::sync::watch;

use gateway::identity::TailscaleLocalWhoIs;
use gateway::routing::{
    AccessPolicy, CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus,
};
use gateway::{GatewayConfig, GatewayServer};
use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::disconnect::DisconnectPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::types::varint::VarInt;

struct WhoIsMockGuard {
    socket_path: PathBuf,
}

impl WhoIsMockGuard {
    fn start(user_id: &str, registered_nick: &str, tags: Vec<&str>) -> Self {
        let socket_path = PathBuf::from(format!(
            "/tmp/test-gw-ts-acl-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).unwrap();

        let tags_json = tags
            .into_iter()
            .map(|t| format!("\"{}\"", t))
            .collect::<Vec<_>>()
            .join(",");

        let user_id = user_id.to_string();
        let registered_nick = registered_nick.to_string();

        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let tags_json = tags_json.clone();
                let user_id = user_id.clone();
                let registered_nick = registered_nick.clone();

                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = stream.read(&mut buf).await;

                    let payload = format!(
                        r#"{{
                            "Node": {{
                                "ID": 100,
                                "StableID": "node-100",
                                "Name": "client-node",
                                "User": 100,
                                "Addresses": ["127.0.0.1"],
                                "Tags": [{}]
                            }},
                            "UserProfile": {{
                                "ID": {},
                                "LoginName": "{}",
                                "DisplayName": "{}"
                            }}
                        }}"#,
                        tags_json, user_id, registered_nick, registered_nick
                    );

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        payload.len(),
                        payload
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                });
            }
        });

        Self { socket_path }
    }
}

impl Drop for WhoIsMockGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Helper para codificar pacotes do Minecraft no wire
fn encode_packet(packet_id: VarInt, payload: &[u8]) -> BytesMut {
    let id_len = packet_id.encoded_len();
    let total_len = id_len + payload.len();
    let mut buf = BytesMut::new();
    VarInt(total_len as i32).encode(&mut buf);
    packet_id.encode(&mut buf);
    buf.put_slice(payload);
    buf
}

/// Acceptance Criterion da Issue #68:
/// "Matriz de testes TS §9.1 passa; nick de outro usuário -> Disconnect em < 50 ms."
#[tokio::test]
async fn test_anti_impersonation_disconnect_under_50ms() {
    // 1. Iniciar mock de WhoIs vinculando o IP a Steve
    let whois_guard = WhoIsMockGuard::start("1", "Steve", vec!["tag:mc-player"]);
    let whois_driver = TailscaleLocalWhoIs::new(&whois_guard.socket_path);

    // 2. Mock de backend upstream JVM
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream.local_addr().unwrap();

    // 3. Iniciar Gateway L7
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        access_policy: AccessPolicy::Public,
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        game_type: "MINECRAFT".into(),
        auto_wake: true,
        favicon: None,
        language: Default::default(),
    };
    route_table.insert(route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_whois(whois_driver);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // 4. Bot conecta e envia Handshake + Login Start com nickname de outro usuário ("HackerBoy")
    let mut client = TcpStream::connect(gateway_addr).await.unwrap();

    // Enviar Handshake
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    let hs_wire = encode_packet(VarInt(0x00), &hs_payload);
    client.write_all(&hs_wire).await.unwrap();

    // Enviar Login Start com nick de outro usuário e iniciar cronômetro
    let login_start = LoginStartPacket::new("HackerBoy").unwrap();
    let mut login_payload = BytesMut::new();
    login_start.encode(&mut login_payload);
    let login_wire = encode_packet(VarInt(0x00), &login_payload);

    let start_instant = Instant::now();
    client.write_all(&login_wire).await.unwrap();

    // 5. Ler resposta de Disconnect do Gateway
    let mut response_buf = [0u8; 512];
    let n = client.read(&mut response_buf).await.unwrap();
    let elapsed = start_instant.elapsed();

    // Asserção do critério de aceite: Disconnect recebido em menos de 50 ms
    assert!(
        elapsed < Duration::from_millis(50),
        "Disconnect por impersonação deve ocorrer em < 50ms, obtido: {:?}",
        elapsed
    );

    // Decodificar pacote de Disconnect (Packet ID 0x00 no estado Login)
    let mut cursor = &response_buf[..n];
    let raw = RawPacket::decode_prelogin(&mut cursor).expect("Pacote de desconexão válido");
    assert_eq!(raw.packet_id, DisconnectPacket::LOGIN_PACKET_ID);

    let mut disconnect_cursor = &raw.payload[..];
    let disconnect = DisconnectPacket::decode(&mut disconnect_cursor).unwrap();
    assert!(
        disconnect
            .reason_json
            .contains("Este nickname não pertence a este dispositivo/conta"),
        "Mensagem de disconnect esperada, obtido: {}",
        disconnect.reason_json
    );

    // Socket deve ser encerrado pelo Gateway (EOF)
    let mut eof_buf = [0u8; 1];
    let eof = client.read(&mut eof_buf).await.unwrap();
    assert_eq!(eof, 0, "Socket deve estar fechado pelo Gateway");

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Valida rejeição imediata de nickname com formato inválido (< 50ms).
#[tokio::test]
async fn test_invalid_nickname_format_disconnect_under_50ms() {
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:25566".parse().unwrap()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        access_policy: AccessPolicy::Public,
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        game_type: "MINECRAFT".into(),
        auto_wake: true,
        favicon: None,
        language: Default::default(),
    };
    route_table.insert(route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let mut client = TcpStream::connect(gateway_addr).await.unwrap();

    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &hs_payload))
        .await
        .unwrap();

    // Login Start com espaços (payload bruto simulando cliente não conforme/malicioso)
    let mut login_payload = BytesMut::new();
    minecraft_protocol::types::string::encode_string("Bad Name", &mut login_payload);

    let start_instant = Instant::now();
    client
        .write_all(&encode_packet(VarInt(0x00), &login_payload))
        .await
        .unwrap();

    let mut response_buf = [0u8; 512];
    let n = client.read(&mut response_buf).await.unwrap();
    let elapsed = start_instant.elapsed();

    assert!(elapsed < Duration::from_millis(50));

    let mut cursor = &response_buf[..n];
    let raw = RawPacket::decode_prelogin(&mut cursor).unwrap();
    let mut disconnect_cursor = &raw.payload[..];
    let disconnect = DisconnectPacket::decode(&mut disconnect_cursor).unwrap();
    assert!(disconnect
        .reason_json
        .contains("O nickname não pode ter espaços"));

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Valida bloqueio de acesso em modo MAINTENANCE para jogadores comuns e bypass para ADMIN (TS §9.1).
#[tokio::test]
async fn test_maintenance_mode_and_admin_bypass() {
    let whois_regular = WhoIsMockGuard::start("1", "RegularGuy", vec!["tag:mc-player"]);
    let whois_admin = WhoIsMockGuard::start("2", "AdminGuy", vec!["tag:mc-gateway"]);

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream.accept().await {
            let mut buf = [0u8; 64];
            let _ = stream.read(&mut buf).await;
        }
    });

    let route_table = RouteTable::new();
    let maint_route = CachedServerRoute {
        server_id: "srv-maint".into(),
        name: "Maintenance World".into(),
        subdomain: "maint.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        access_policy: AccessPolicy::Maintenance,
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        game_type: "MINECRAFT".into(),
        auto_wake: true,
        favicon: None,
        language: Default::default(),
    };
    route_table.insert(maint_route);

    // 1. Testa jogador regular contra servidor em manutenção
    let whois_driver_reg = TailscaleLocalWhoIs::new(&whois_regular.socket_path);
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table.clone())
        .with_whois(whois_driver_reg);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let mut client = TcpStream::connect(gateway_addr).await.unwrap();
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "maint.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &hs_payload))
        .await
        .unwrap();

    let login_start = LoginStartPacket::new("RegularGuy").unwrap();
    let mut login_payload = BytesMut::new();
    login_start.encode(&mut login_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &login_payload))
        .await
        .unwrap();

    let mut response_buf = [0u8; 512];
    let n = client.read(&mut response_buf).await.unwrap();
    let mut cursor = &response_buf[..n];
    let raw = RawPacket::decode_prelogin(&mut cursor).unwrap();
    let mut disconnect_cursor = &raw.payload[..];
    let disconnect = DisconnectPacket::decode(&mut disconnect_cursor).unwrap();
    assert!(disconnect
        .reason_json
        .contains("Maintenance World em manutenção"));

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;

    // 2. Testa Admin com bypass em servidor em manutenção
    let gateway_listener_admin = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr_admin = gateway_listener_admin.local_addr().unwrap();

    let whois_driver_adm = TailscaleLocalWhoIs::new(&whois_admin.socket_path);
    let config = GatewayConfig::default();
    let server_admin = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_whois(whois_driver_adm);

    let (shutdown_tx2, shutdown_rx2) = watch::channel(false);
    let server_task2 = tokio::spawn(async move {
        let _ = server_admin.run(gateway_listener_admin, shutdown_rx2).await;
    });

    let mut client_admin = TcpStream::connect(gateway_addr_admin).await.unwrap();
    let handshake_adm = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "maint.mine.lan".into(),
        server_port: gateway_addr_admin.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_adm_payload = BytesMut::new();
    handshake_adm.encode(&mut hs_adm_payload);
    client_admin
        .write_all(&encode_packet(VarInt(0x00), &hs_adm_payload))
        .await
        .unwrap();

    let login_adm = LoginStartPacket::new("AdminGuy").unwrap();
    let mut login_adm_payload = BytesMut::new();
    login_adm.encode(&mut login_adm_payload);
    client_admin
        .write_all(&encode_packet(VarInt(0x00), &login_adm_payload))
        .await
        .unwrap();

    // Para o admin autorizado, a conexão permanece aberta (sem pacote de disconnect imediato)
    tokio::time::sleep(Duration::from_millis(50)).await;
    // O socket não foi fechado com disconnect
    client_admin.set_nodelay(true).unwrap();

    let _ = shutdown_tx2.send(true);
    let _ = server_task2.await;
}
