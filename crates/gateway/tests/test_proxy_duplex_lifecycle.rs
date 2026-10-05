use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::{BufMut, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::time::sleep;

use gateway::routing::{CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus};
use gateway::session::SessionManager;
use gateway::{GatewayConfig, GatewayServer};

use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::proxy_protocol::header::ProxyHeader;
use minecraft_protocol::types::varint::VarInt;

/// Critério de aceite da Issue #53 (RF-GW-11, GW:384-398):
/// "Fechar um lado do pipe fecha o outro e remove a sessão do mapa."
/// Cenário A: Cliente fecha o socket -> Upstream é encerrado -> Sessão é removida do mapa.
#[tokio::test]
async fn test_client_close_terminates_upstream_and_deregisters_session() {
    let upstream_closed = Arc::new(AtomicBool::new(false));
    let upstream_closed_clone = Arc::clone(&upstream_closed);

    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock upstream JVM
    let upstream_task = tokio::spawn(async move {
        let (mut stream, _) = upstream_listener.accept().await.unwrap();

        // 1. Ler o Handshake e LoginStart reinjetados pelo Gateway
        let mut buf = [0u8; 512];
        let n = stream.read(&mut buf).await.unwrap();
        assert!(
            n > 0,
            "Deveria ter recebido replay de Handshake e LoginStart"
        );

        // 2. Aguardar que o cliente feche o outro lado do pipe
        let n_after_client_close = stream.read(&mut buf).await.unwrap_or(0);
        assert_eq!(
            n_after_client_close, 0,
            "Upstream deveria receber EOF quando o cliente encerra"
        );
        upstream_closed_clone.store(true, Ordering::SeqCst);
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival World".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let session_mgr = SessionManager::new();
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_session_manager(session_mgr.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // Conexão do Cliente
    let mut client_stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

    // 1. Enviar Handshake (NextState = 2 Login)
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    // 2. Enviar Login Start
    let login = LoginStartPacket::new("PlayerOne").unwrap();
    let mut login_payload = BytesMut::new();
    login.encode(&mut login_payload);

    VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&login_payload);

    client_stream.write_all(&wire).await.unwrap();

    // Aguardar o proxy registrar a sessão
    sleep(Duration::from_millis(50)).await;
    assert_eq!(
        session_mgr.active_count(),
        1,
        "Sessão deve estar registrada no DashMap"
    );

    // Fechar explicitamente o socket do cliente
    drop(client_stream);

    // Aguardar o teardown simétrico do proxy
    upstream_task.await.unwrap();
    assert!(
        upstream_closed.load(Ordering::SeqCst),
        "Upstream deve ter sido fechado"
    );

    sleep(Duration::from_millis(50)).await;
    assert_eq!(
        session_mgr.active_count(),
        0,
        "Sessão deve ser removida do mapa após o encerramento do pipe (Critério de Aceite)"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Critério de aceite da Issue #53:
/// Cenário B: Upstream JVM fecha o socket -> Cliente é encerrado -> Sessão é removida do mapa.
#[tokio::test]
async fn test_upstream_close_terminates_client_and_deregisters_session() {
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock upstream JVM que fecha imediatamente após receber login
    tokio::spawn(async move {
        let (mut stream, _) = upstream_listener.accept().await.unwrap();
        let mut buf = [0u8; 512];
        let _ = stream.read(&mut buf).await;
        // Fecha abruptamente o socket upstream
        let _ = stream.shutdown().await;
        drop(stream);
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival World".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let session_mgr = SessionManager::new();
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_session_manager(session_mgr.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let mut client_stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

    // Enviar Handshake e LoginStart
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    let login = LoginStartPacket::new("PlayerTwo").unwrap();
    let mut login_payload = BytesMut::new();
    login.encode(&mut login_payload);

    VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&login_payload);

    client_stream.write_all(&wire).await.unwrap();

    // Ler do cliente: deve receber EOF quando upstream fechar
    let mut buf = [0u8; 64];
    let n = client_stream.read(&mut buf).await.unwrap_or(0);
    assert_eq!(n, 0, "Cliente deve receber EOF quando o upstream JVM fecha");

    sleep(Duration::from_millis(50)).await;
    assert_eq!(
        session_mgr.active_count(),
        0,
        "Sessão deve ser removida do mapa após encerramento do upstream"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Testa a injeção do cabeçalho PROXY Protocol v2 no upstream quando habilitado na rota (RF-GW-11).
#[tokio::test]
async fn test_upstream_proxy_protocol_v2_injection() {
    let proxy_v2_received = Arc::new(AtomicBool::new(false));
    let proxy_v2_received_clone = Arc::clone(&proxy_v2_received);

    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    tokio::spawn(async move {
        let (mut stream, _) = upstream_listener.accept().await.unwrap();
        let mut buf = BytesMut::with_capacity(512);

        // Ler dados e verificar se o cabeçalho PROXY v2 foi injetado pelo Gateway
        loop {
            let mut cursor = &buf[..];
            if let Ok(Some(header)) = ProxyHeader::parse(&mut cursor) {
                if let Some(src) = header.address.src_socket_addr() {
                    assert_eq!(src.ip(), "127.0.0.1".parse::<std::net::IpAddr>().unwrap());
                    proxy_v2_received_clone.store(true, Ordering::SeqCst);
                    break;
                }
            }
            let n = stream.read_buf(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-paper".into(),
        name: "Paper Server".into(),
        subdomain: "paper.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: true, // INJEÇÃO ATIVADA
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let mut client_stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "paper.mine.lan".into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    let login = LoginStartPacket::new("PlayerProxy").unwrap();
    let mut login_payload = BytesMut::new();
    login.encode(&mut login_payload);

    VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&login_payload);

    client_stream.write_all(&wire).await.unwrap();

    sleep(Duration::from_millis(100)).await;
    assert!(
        proxy_v2_received.load(Ordering::SeqCst),
        "Upstream deve ter recebido o cabeçalho PROXY Protocol v2 sintetizado"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// Testa o despejo forçado de sessão anterior quando o mesmo nick conecta novamente (RF-GW-13).
#[tokio::test]
async fn test_anti_cloning_session_eviction() {
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock upstream JVM que mantém as conexões abertas
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf).await;
                // Mantém conexão viva aguardando
                let mut sink = [0u8; 16];
                while let Ok(n) = stream.read(&mut sink).await {
                    if n == 0 {
                        break;
                    }
                }
            });
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival World".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let session_mgr = SessionManager::new();
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_session_manager(session_mgr.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // 1. Cliente 1 conecta com nick "Steve"
    let mut client1 = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
    send_login(
        &mut client1,
        gateway_addr.port(),
        "survival.mine.lan",
        "Steve",
    )
    .await;

    sleep(Duration::from_millis(50)).await;
    assert_eq!(session_mgr.active_count(), 1, "Sessão 1 deve estar ativa");

    // 2. Cliente 2 conecta com o mesmo nick "Steve"
    let mut client2 = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
    send_login(
        &mut client2,
        gateway_addr.port(),
        "survival.mine.lan",
        "Steve",
    )
    .await;

    sleep(Duration::from_millis(50)).await;

    // 3. Cliente 1 deve ter recebido EOF / sido desconectado pelo despejo da sessão (RF-GW-13)
    let mut buf = [0u8; 64];
    let n = client1.read(&mut buf).await.unwrap_or(0);
    assert_eq!(n, 0, "Cliente 1 deve ter sido despejado e desconectado");

    // Total de sessões ativas deve permanecer 1 (apenas a nova)
    assert_eq!(
        session_mgr.active_count(),
        1,
        "Apenas a sessão mais recente deve estar ativa"
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

async fn send_login(stream: &mut tokio::net::TcpStream, port: u16, host: &str, nick: &str) {
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: host.into(),
        server_port: port,
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    let login = LoginStartPacket::new(nick).unwrap();
    let mut login_payload = BytesMut::new();
    login.encode(&mut login_payload);

    VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&login_payload);

    stream.write_all(&wire).await.unwrap();
}
