use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::{BufMut, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio::time::sleep;

use gateway::routing::{CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus};
use gateway::{GatewayConfig, GatewayServer};

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::disconnect::DisconnectPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::types::varint::VarInt;

fn encode_packet(packet_id: VarInt, payload: &[u8]) -> Vec<u8> {
    let mut body = BytesMut::new();
    packet_id.encode(&mut body);
    body.put_slice(payload);

    let total_len = VarInt(body.len() as i32);
    let mut final_buf = BytesMut::new();
    total_len.encode(&mut final_buf);
    final_buf.put_slice(&body);
    final_buf.to_vec()
}

/// RF-GW-10: Auto-Wake com Hold Connection de até 25s.
/// Cenário A: Servidor STOPPED com auto_wake=true recebe login -> entra em Hold ->
/// status muda para READY -> conexão estabelecida com upstream JVM com sucesso.
#[tokio::test]
async fn test_auto_wake_hold_connection_success() {
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    let upstream_received = Arc::new(AtomicBool::new(false));
    let upstream_received_clone = Arc::clone(&upstream_received);

    tokio::spawn(async move {
        if let Ok((mut stream, _)) = upstream_listener.accept().await {
            let mut buf = [0u8; 512];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            if n > 0 {
                upstream_received_clone.store(true, Ordering::SeqCst);
            }
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-hibernating".into(),
        name: "Hibernating Server".into(),
        subdomain: "hibernating.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Stopped,
        auto_wake: true,
        ..Default::default()
    };
    route_table.insert(route);

    let (wake_tx, mut wake_rx) = mpsc::unbounded_channel::<String>();
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table.clone())
        .with_wake_sender(wake_tx);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // Conexão do cliente Minecraft
    let mut client = TcpStream::connect(gateway_addr).await.unwrap();

    // 1. Handshake para Login
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "hibernating.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &hs_payload))
        .await
        .unwrap();

    // 2. LoginStart
    let login_start = LoginStartPacket {
        username: "Steve".into(),
        player_uuid: None,
    };
    let mut ls_payload = BytesMut::new();
    login_start.encode(&mut ls_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &ls_payload))
        .await
        .unwrap();

    // 3. Verificar que o evento WAKE foi emitido para o canal
    let woke_server_id = tokio::time::timeout(Duration::from_millis(500), wake_rx.recv())
        .await
        .expect("Timeout esperando wake event")
        .expect("Canal fechado");
    assert_eq!(woke_server_id, "srv-hibernating");

    // 4. Simular que o Pod subiu e Control Plane avisou que o status mudou para READY
    sleep(Duration::from_millis(50)).await;
    route_table.update_status("srv-hibernating", ServerInstanceStatus::Ready);

    // 5. Verificar que o upstream recebeu o fluxo após descongelação do Hold
    sleep(Duration::from_millis(100)).await;
    assert!(
        upstream_received.load(Ordering::SeqCst),
        "Upstream deveria ter recebido o tráfego após transição para READY"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// RF-GW-10: Servidor STOPPED com auto_wake=false deve ser rejeitado imediatamente sem Hold.
#[tokio::test]
async fn test_auto_wake_disabled_immediate_rejection() {
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-no-wake".into(),
        name: "No Wake Server".into(),
        subdomain: "nowake.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:25569".parse().unwrap()),
        status: ServerInstanceStatus::Stopped,
        auto_wake: false,
        ..Default::default()
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
        server_address: "nowake.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &hs_payload))
        .await
        .unwrap();

    let login_start = LoginStartPacket {
        username: "Alex".into(),
        player_uuid: None,
    };
    let mut ls_payload = BytesMut::new();
    login_start.encode(&mut ls_payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &ls_payload))
        .await
        .unwrap();

    // Deve receber Disconnect imediato
    let mut buf = [0u8; 512];
    let n = client.read(&mut buf).await.unwrap();
    assert!(n > 0);

    let mut cursor = &buf[..n];
    let raw = RawPacket::decode_prelogin(&mut cursor).unwrap();
    let mut dc_cursor = &raw.payload[..];
    let disconnect = DisconnectPacket::decode(&mut dc_cursor).unwrap();
    assert!(disconnect
        .reason_json
        .contains("despertar automático está desativado"));

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// RF-GW-10: Teste do wait_for_ready da RouteTable (Hold Timeout de 25s / simulado com duração customizada)
#[tokio::test]
async fn test_route_table_wait_for_ready_timeout_and_ready() {
    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-timeout".into(),
        name: "Timeout Server".into(),
        subdomain: "timeout.mine.lan".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:25569".parse().unwrap()),
        status: ServerInstanceStatus::Stopped,
        auto_wake: true,
        ..Default::default()
    };
    route_table.insert(route);

    // 1. Timeout quando não transiciona para Ready
    let err = route_table
        .wait_for_ready("srv-timeout", Duration::from_millis(50))
        .await
        .unwrap_err();
    assert!(matches!(err, gateway::routing::HoldError::Timeout));

    // 2. Desperta com sucesso quando transiciona dentro do prazo
    let table_clone = route_table.clone();
    tokio::spawn(async move {
        sleep(Duration::from_millis(30)).await;
        table_clone.update_status("srv-timeout", ServerInstanceStatus::Ready);
    });

    let target = route_table
        .wait_for_ready("srv-timeout", Duration::from_millis(200))
        .await
        .unwrap();
    assert_eq!(target.target_addr.unwrap().port(), 25569);
}
