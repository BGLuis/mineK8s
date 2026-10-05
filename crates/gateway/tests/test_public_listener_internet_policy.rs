use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::BytesMut;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio::time::sleep;

use gateway::identity::is_tailscale_ip;
use gateway::routing::{
    AccessPolicy, CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus,
};
use gateway::{GatewayConfig, GatewayServer};

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::disconnect::DisconnectPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::packets::status::StatusRequestPacket;
use minecraft_protocol::types::varint::VarInt;

#[test]
fn test_is_tailscale_ip_sec01_compliance() {
    // Faixa CGNAT Tailscale: 100.64.0.0/10
    assert!(is_tailscale_ip("100.64.0.1".parse().unwrap()));
    assert!(is_tailscale_ip("100.100.50.25".parse().unwrap()));
    assert!(is_tailscale_ip("100.127.255.254".parse().unwrap()));
    assert!(is_tailscale_ip("127.0.0.1".parse().unwrap())); // loopback permitido para testes locais

    // Fora da faixa Tailscale (IPs públicos da Internet) -> SEC-01 deve rejeitar no listener privado
    assert!(!is_tailscale_ip("203.0.113.10".parse().unwrap()));
    assert!(!is_tailscale_ip("8.8.8.8".parse().unwrap()));
    assert!(!is_tailscale_ip("1.1.1.1".parse().unwrap()));
    assert!(!is_tailscale_ip("192.168.1.50".parse().unwrap()));
    assert!(!is_tailscale_ip("10.0.0.1".parse().unwrap()));
    assert!(!is_tailscale_ip("100.63.255.255".parse().unwrap())); // logo abaixo do limite inferior
    assert!(!is_tailscale_ip("100.128.0.0".parse().unwrap())); // logo acima do limite superior
}

#[tokio::test]
async fn test_public_listener_routes_internet_world_via_srv_target() {
    let upstream_connections = Arc::new(AtomicUsize::new(0));
    let upstream_conn_clone = Arc::clone(&upstream_connections);

    // Mock upstream JVM
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    let _mock_jvm = tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            upstream_conn_clone.fetch_add(1, Ordering::SeqCst);
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
        }
    });

    let priv_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_addr = pub_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let public_route = CachedServerRoute {
        server_id: "srv-public-1".into(),
        name: "Public Survival".into(),
        subdomain: "survival".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        access_policy: AccessPolicy::Internet, // RF-CF-01: Política INTERNET
        ..Default::default()
    };
    route_table.insert(public_route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);

    let (_shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server
            .run_dual(priv_listener, Some(pub_listener), shutdown_rx)
            .await;
    });

    sleep(Duration::from_millis(100)).await;

    // Conecta no listener público simulando cliente Minecraft vindo de SRV
    let mut client = TcpStream::connect(pub_addr).await.unwrap();

    // Envia Handshake com o target do SRV: survival.minek8s.net (RF-CF-05 [F12])
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.minek8s.net".into(),
        server_port: pub_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let raw_hs = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut wire = BytesMut::new();
    raw_hs.encode(&mut wire);
    client.write_all(&wire).await.unwrap();

    // Envia Login Start
    let login_start = LoginStartPacket {
        username: "PublicPlayer".into(),
        player_uuid: None,
    };
    let mut ls_payload = BytesMut::new();
    login_start.encode(&mut ls_payload);

    let raw_ls = RawPacket {
        packet_id: LoginStartPacket::PACKET_ID,
        payload: ls_payload.freeze(),
    };
    let mut wire_ls = BytesMut::new();
    raw_ls.encode(&mut wire_ls);
    client.write_all(&wire_ls).await.unwrap();

    // Aguarda o encaminhamento duplex até o upstream
    sleep(Duration::from_millis(200)).await;

    // Upstream deve ter recebido a conexão repassada
    assert_eq!(upstream_connections.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_public_listener_rejects_private_worlds() {
    let priv_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_addr = pub_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let private_route = CachedServerRoute {
        server_id: "srv-private-group".into(),
        name: "Private Group Server".into(),
        subdomain: "private-group".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:29999".parse().unwrap()),
        status: ServerInstanceStatus::Ready,
        access_policy: AccessPolicy::Group, // Política GROUP privada
        ..Default::default()
    };
    route_table.insert(private_route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);

    let (_shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server
            .run_dual(priv_listener, Some(pub_listener), shutdown_rx)
            .await;
    });

    sleep(Duration::from_millis(100)).await;

    // Conecta no listener público tentando acessar o mundo privado
    let mut client = TcpStream::connect(pub_addr).await.unwrap();

    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "private-group.minek8s.net".into(),
        server_port: pub_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let raw_hs = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut wire = BytesMut::new();
    raw_hs.encode(&mut wire);
    client.write_all(&wire).await.unwrap();

    let login_start = LoginStartPacket {
        username: "RandomScanner".into(),
        player_uuid: None,
    };
    let mut ls_payload = BytesMut::new();
    login_start.encode(&mut ls_payload);

    let raw_ls = RawPacket {
        packet_id: LoginStartPacket::PACKET_ID,
        payload: ls_payload.freeze(),
    };
    let mut wire_ls = BytesMut::new();
    raw_ls.encode(&mut wire_ls);
    client.write_all(&wire_ls).await.unwrap();

    // Deve receber pacote de Disconnect com rejeição de acesso público
    let mut buf = [0u8; 1024];
    let n = client.read(&mut buf).await.unwrap();
    assert!(n > 0);

    let mut cursor = &buf[..n];
    let raw_pkt = RawPacket::decode_prelogin(&mut cursor).unwrap();
    assert_eq!(raw_pkt.packet_id.0, 0x00); // Disconnect packet no estado Login

    let mut payload_cursor = &raw_pkt.payload[..];
    let disconnect = DisconnectPacket::decode(&mut payload_cursor).unwrap();
    assert!(disconnect
        .reason_json
        .contains("não aceita conexões públicas"));
}

#[tokio::test]
async fn test_auto_wake_anti_scanner_behavior() {
    let (wake_tx, mut wake_rx) = mpsc::unbounded_channel::<String>();

    let priv_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let pub_addr = pub_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let stopped_route = CachedServerRoute {
        server_id: "srv-stopped-public".into(),
        name: "Stopped Public Server".into(),
        subdomain: "public-sleep".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:29998".parse().unwrap()),
        status: ServerInstanceStatus::Stopped,
        access_policy: AccessPolicy::Internet,
        auto_wake: true,
        ..Default::default()
    };
    route_table.insert(stopped_route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_wake_sender(wake_tx);

    let (_shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server
            .run_dual(priv_listener, Some(pub_listener), shutdown_rx)
            .await;
    });

    sleep(Duration::from_millis(100)).await;

    // 1. Scanner de internet faz apenas Server List Ping (Status)
    let mut scanner = TcpStream::connect(pub_addr).await.unwrap();
    let handshake_status = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "public-sleep.minek8s.net".into(),
        server_port: pub_addr.port(),
        next_state: HandshakeNextState::Status,
    };
    let mut hs_payload = BytesMut::new();
    handshake_status.encode(&mut hs_payload);
    let raw_hs = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut wire = BytesMut::new();
    raw_hs.encode(&mut wire);
    scanner.write_all(&wire).await.unwrap();

    let mut req_wire = BytesMut::new();
    let raw_req = RawPacket {
        packet_id: StatusRequestPacket::PACKET_ID,
        payload: bytes::Bytes::new(),
    };
    raw_req.encode(&mut req_wire);
    scanner.write_all(&req_wire).await.unwrap();

    sleep(Duration::from_millis(100)).await;

    // RF-CF-08: Scanner NÃO acorda a JVM!
    assert!(
        wake_rx.try_recv().is_err(),
        "Server List Ping não deve disparar Auto-Wake em mundos INTERNET"
    );

    // 2. Jogador real envia LoginStart válido -> Deve acordar a JVM
    let mut player = TcpStream::connect(pub_addr).await.unwrap();
    let handshake_login = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "public-sleep.minek8s.net".into(),
        server_port: pub_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_l_payload = BytesMut::new();
    handshake_login.encode(&mut hs_l_payload);
    let raw_hs_l = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_l_payload.freeze(),
    };
    let mut wire_l = BytesMut::new();
    raw_hs_l.encode(&mut wire_l);
    player.write_all(&wire_l).await.unwrap();

    let login_start = LoginStartPacket {
        username: "ValidPlayer".into(),
        player_uuid: None,
    };
    let mut ls_payload = BytesMut::new();
    login_start.encode(&mut ls_payload);
    let raw_ls = RawPacket {
        packet_id: LoginStartPacket::PACKET_ID,
        payload: ls_payload.freeze(),
    };
    let mut wire_ls = BytesMut::new();
    raw_ls.encode(&mut wire_ls);
    player.write_all(&wire_ls).await.unwrap();

    sleep(Duration::from_millis(100)).await;

    // Deve ter recebido o sinal de wake
    let awakened_id = wake_rx.try_recv().unwrap();
    assert_eq!(awakened_id, "srv-stopped-public");
}
