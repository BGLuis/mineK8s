use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use gateway::routing::{CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus};
use gateway::{GatewayConfig, GatewayServer};

/// Testa operações fundamentais da RouteTable (RF-GW-07): inserção, busca por hostname,
/// insensibilidade a maiúsculas/minúsculas e fallback para servidor padrão.
#[test]
fn test_route_table_operations_and_fallback() {
    let table = RouteTable::new();

    let route_survival = CachedServerRoute {
        server_id: "srv-survival".into(),
        name: "Survival World".into(),
        subdomain: "survival.mine.lan".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:25566".parse().unwrap()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        ..Default::default()
    };

    let route_lobby = CachedServerRoute {
        server_id: "srv-lobby".into(),
        name: "Default Lobby".into(),
        subdomain: "lobby.mine.lan".into(),
        listener_port: 25565,
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some("127.0.0.1:25567".parse().unwrap()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 50,
        protocol_version: 765,
        ..Default::default()
    };

    table.insert(route_survival);
    table.insert(route_lobby);
    table.set_default_server(Some("srv-lobby".into()));

    // 1. Busca exata insensível a maiúsculas/minúsculas
    let found = table.lookup_virtual_host(25565, "SURVIVAL.MINE.LAN");
    assert!(found.is_some());
    assert_eq!(found.unwrap().server_id, "srv-survival");

    // 2. Busca de hostname inexistente deve cair no fallback default_server
    let fallback = table.lookup_virtual_host(25565, "desconhecido.mine.lan");
    assert!(fallback.is_some());
    assert_eq!(fallback.unwrap().server_id, "srv-lobby");

    // 3. Remoção de rota
    let removed = table.remove("srv-survival");
    assert!(removed.is_some());
    // Agora survival deve cair no lobby fallback
    let fallback_after_remove = table.lookup_virtual_host(25565, "survival.mine.lan");
    assert_eq!(fallback_after_remove.unwrap().server_id, "srv-lobby");
}

/// Critério de aceite da Issue #51 (RF-MG-03, Inventário §2.9):
/// Valida que uma rota `dedicated-port` faz encaminhamento L4 transparente direto SEM invocar o parser do Minecraft.
#[tokio::test]
async fn test_dedicated_port_l4_forward_without_parser() {
    // 1. Iniciar mock de backend upstream (ex.: servidor de jogo não-Minecraft / Terraria)
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    let upstream_task = tokio::spawn(async move {
        let (mut stream, _) = upstream_listener.accept().await.unwrap();
        let mut buf = [0u8; 128];
        let n = stream.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"TERRARIA_RAW_BYTES_SEM_PARSER");

        // Responder com payload binário arbitrário
        stream.write_all(b"UPSTREAM_PONG_L4_OK").await.unwrap();
    });

    // 2. Configurar Gateway com listener na porta dedicada
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let dedicated_route = CachedServerRoute {
        server_id: "srv-terraria".into(),
        name: "Terraria Dedicated".into(),
        subdomain: "".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::DedicatedPort,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 8,
        protocol_version: 0,
        ..Default::default()
    };
    route_table.insert(dedicated_route);

    let config = GatewayConfig::default();
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // 3. Cliente conecta e envia bytes brutos incompatíveis com o parser Minecraft
    let client_task = tokio::spawn(async move {
        let mut stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
        // Envia payload que causaria erro fatal no parser Minecraft
        stream.write_all(b"TERRARIA_RAW_BYTES_SEM_PARSER").await.unwrap();

        let mut reply = [0u8; 128];
        let n = stream.read(&mut reply).await.unwrap();
        assert_eq!(&reply[..n], b"UPSTREAM_PONG_L4_OK");
    });

    client_task.await.unwrap();
    upstream_task.await.unwrap();

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}
