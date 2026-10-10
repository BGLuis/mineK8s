use std::net::SocketAddr;
use std::time::Duration;

use gateway::ipc::client::apply_route_update_event;
use gateway::ipc::protocol::{RouteAction, RouteUpdateEvent};
use gateway::routing::RouteTable;
use gateway::session::SessionManager;
use gateway::{GatewayConfig, GatewayServer};
use gateway_test_support::{open_login, LoginOutcome};
use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::disconnect::DisconnectPacket;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const HOST: &str = "world.mine.lan";
const UPSTREAM_GREETING: &[u8] = b"UPSTREAM_REACHED";

struct Harness {
    addr: SocketAddr,
    sessions: SessionManager,
    shutdown: watch::Sender<bool>,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

async fn start_gateway(route_table: RouteTable) -> Harness {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let sessions = SessionManager::new();
    let server = GatewayServer::new(GatewayConfig::default())
        .with_route_table(route_table)
        .with_session_manager(sessions.clone());
    let (shutdown, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server.run(listener, shutdown_rx).await;
    });
    Harness {
        addr,
        sessions,
        shutdown,
    }
}

/// Upstream que lê o replay do Gateway e responde com uma marca reconhecível.
async fn greeting_upstream() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut replay = [0u8; 512];
                let _ = stream.read(&mut replay).await;
                let _ = stream.write_all(UPSTREAM_GREETING).await;
                let _ = stream.read(&mut replay).await;
            });
        }
    });
    port
}

fn route_event(action: RouteAction, target: &str, status: &str) -> RouteUpdateEvent {
    RouteUpdateEvent {
        action: action as i32,
        server_id: "srv-world".into(),
        subdomain: HOST.into(),
        target_ip_port: target.into(),
        status: status.into(),
        access_policy: "PUBLIC".into(),
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        proxy_protocol: false,
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 0,
        auto_wake: true,
        favicon: String::new(),
        name: String::new(),
        max_players: 0,
        language: String::new(),
    }
}

async fn read_outcome(mut client: TcpStream) -> LoginOutcome {
    let mut buf = [0u8; 1024];
    let n = tokio::time::timeout(Duration::from_secs(10), client.read(&mut buf))
        .await
        .expect("o Gateway não respondeu ao login")
        .unwrap();
    if buf[..n].starts_with(UPSTREAM_GREETING) {
        return LoginOutcome::Proxied;
    }
    let mut cursor = &buf[..n];
    let raw = RawPacket::decode_prelogin(&mut cursor).expect("pacote de Disconnect");
    let mut payload = &raw.payload[..];
    LoginOutcome::Disconnected(DisconnectPacket::decode(&mut payload).unwrap().reason_json)
}

#[tokio::test]
async fn route_pushed_over_ipc_with_a_hostname_opens_the_session_and_relays_traffic() {
    let upstream_port = greeting_upstream().await;
    let route_table = RouteTable::new();
    apply_route_update_event(
        &route_table,
        route_event(
            RouteAction::Upsert,
            &format!("localhost:{upstream_port}"),
            "READY",
        ),
    );
    let gw = start_gateway(route_table).await;

    let client = open_login(gw.addr, HOST, "PlayerOne").await;

    assert_eq!(read_outcome(client).await, LoginOutcome::Proxied);
}

#[tokio::test]
async fn hostname_delivered_by_a_status_change_is_resolved_too() {
    let upstream_port = greeting_upstream().await;
    let route_table = RouteTable::new();
    apply_route_update_event(
        &route_table,
        route_event(RouteAction::Upsert, "", "STOPPED"),
    );
    apply_route_update_event(
        &route_table,
        route_event(
            RouteAction::StatusChange,
            &format!("localhost:{upstream_port}"),
            "READY",
        ),
    );
    let gw = start_gateway(route_table).await;

    let client = open_login(gw.addr, HOST, "PlayerOne").await;

    assert_eq!(read_outcome(client).await, LoginOutcome::Proxied);
}

#[tokio::test]
async fn unresolvable_hostname_tells_the_player_and_leaves_the_listener_serving() {
    let upstream_port = greeting_upstream().await;
    let route_table = RouteTable::new();
    apply_route_update_event(
        &route_table,
        route_event(
            RouteAction::Upsert,
            "mc-gone.minekubernetes.invalid:25565",
            "READY",
        ),
    );
    let mut healthy = route_event(
        RouteAction::Upsert,
        &format!("localhost:{upstream_port}"),
        "READY",
    );
    healthy.server_id = "srv-healthy".into();
    healthy.subdomain = "healthy.mine.lan".into();
    apply_route_update_event(&route_table, healthy);
    let gw = start_gateway(route_table).await;

    let broken = open_login(gw.addr, HOST, "PlayerOne").await;
    match read_outcome(broken).await {
        LoginOutcome::Disconnected(reason) => {
            assert!(
                reason.contains("localizar o servidor de destino"),
                "motivo inesperado: {reason}"
            )
        }
        LoginOutcome::Proxied => panic!("hostname inexistente não pode abrir sessão"),
    }
    assert_eq!(
        gw.sessions.active_count(),
        0,
        "login que não abriu upstream não pode deixar sessão"
    );

    let healthy = open_login(gw.addr, "healthy.mine.lan", "PlayerTwo").await;
    assert_eq!(read_outcome(healthy).await, LoginOutcome::Proxied);
}

#[tokio::test]
async fn refused_upstream_tells_the_player_the_server_is_unavailable() {
    let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead_port = dead.local_addr().unwrap().port();
    drop(dead);
    let route_table = RouteTable::new();
    apply_route_update_event(
        &route_table,
        route_event(
            RouteAction::Upsert,
            &format!("localhost:{dead_port}"),
            "READY",
        ),
    );
    let gw = start_gateway(route_table).await;

    let client = open_login(gw.addr, HOST, "PlayerOne").await;

    match read_outcome(client).await {
        LoginOutcome::Disconnected(reason) => assert!(reason.contains("indisponível"), "{reason}"),
        LoginOutcome::Proxied => panic!("upstream recusando conexão não pode abrir sessão"),
    }
    assert_eq!(gw.sessions.active_count(), 0);
}

#[tokio::test]
async fn dedicated_port_route_forwards_to_a_hostname_target() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut stream, _) = upstream.accept().await.unwrap();
        let mut buf = [0u8; 64];
        let n = stream.read(&mut buf).await.unwrap();
        stream.write_all(&buf[..n]).await.unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut event = route_event(
        RouteAction::Upsert,
        &format!("localhost:{upstream_port}"),
        "READY",
    );
    event.routing_model = "DedicatedPort".into();
    event.listen_port = addr.port() as i32;
    let route_table = RouteTable::new();
    apply_route_update_event(&route_table, event);
    let server = GatewayServer::new(GatewayConfig::default()).with_route_table(route_table);
    let (shutdown, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server.run(listener, shutdown_rx).await;
    });

    let mut client = TcpStream::connect(addr).await.unwrap();
    client.write_all(b"RAW_L4_BYTES").await.unwrap();
    let mut echoed = [0u8; 12];
    tokio::time::timeout(Duration::from_secs(5), client.read_exact(&mut echoed))
        .await
        .expect("sem resposta do upstream")
        .unwrap();

    assert_eq!(&echoed, b"RAW_L4_BYTES");
    let _ = shutdown.send(true);
}
