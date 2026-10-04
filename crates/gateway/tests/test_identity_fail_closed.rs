mod common;

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use common::{
    dead_socket_path, hold_upstream, login_outcome, FakeTailscaled, LoginOutcome, MockControlPlane,
};
use gateway::identity::TailscaleLocalWhoIs;
use gateway::ipc::GatewayIpcClient;
use gateway::routing::{
    AccessPolicy, CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus,
};
use gateway::{GatewayConfig, GatewayServer};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};

const HOST: &str = "world.mine.lan";

struct Harness {
    addr: SocketAddr,
    upstream_accepts: mpsc::UnboundedReceiver<()>,
    shutdown: watch::Sender<bool>,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

impl Harness {
    async fn login(&mut self, nick: &str) -> LoginOutcome {
        login_outcome(self.addr, HOST, nick, &mut self.upstream_accepts).await
    }
}

/// Gateway no listener privado com uma única rota, ligado às fontes de identidade pedidas.
async fn start_gateway(
    policy: AccessPolicy,
    allowed_group_ids: &[&str],
    allowed_user_ids: &[&str],
    whois_socket: Option<&std::path::Path>,
    control_plane_url: Option<&str>,
) -> Harness {
    let (upstream_addr, upstream_accepts) = hold_upstream().await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    route_table.insert(CachedServerRoute {
        server_id: "srv-world".into(),
        name: "World".into(),
        subdomain: HOST.into(),
        listener_port: addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 20,
        protocol_version: 765,
        access_policy: policy,
        allowed_group_ids: allowed_group_ids.iter().map(|s| s.to_string()).collect(),
        allowed_user_ids: allowed_user_ids.iter().map(|s| s.to_string()).collect(),
        game_type: "MINECRAFT".into(),
        auto_wake: true,
    });

    let mut server = GatewayServer::new(GatewayConfig::default()).with_route_table(route_table);
    if let Some(path) = whois_socket {
        server = server.with_whois(TailscaleLocalWhoIs::new(path));
    }
    if let Some(url) = control_plane_url {
        server = server.with_identity_control_plane(GatewayIpcClient::connect_lazy(url).unwrap());
    }

    let (shutdown, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = server.run(listener, shutdown_rx).await;
    });
    Harness {
        addr,
        upstream_accepts,
        shutdown,
    }
}

fn assert_refused(outcome: LoginOutcome, expected_reason: &str) {
    match outcome {
        LoginOutcome::Disconnected(reason) => {
            assert!(
                reason.contains(expected_reason),
                "motivo inesperado: {reason}"
            )
        }
        LoginOutcome::Proxied => panic!("o login deveria ter sido recusado ({expected_reason})"),
    }
}

#[tokio::test]
async fn unresolved_identity_is_refused_on_every_identity_dependent_policy() {
    let dead = dead_socket_path();
    for policy in [
        AccessPolicy::Group,
        AccessPolicy::Individual,
        AccessPolicy::Maintenance,
    ] {
        let mut gw =
            start_gateway(policy, &["grp-e2e"], &["usr-player-1"], Some(&dead), None).await;
        assert_refused(gw.login("PlayerOne").await, "verificar sua identidade");
    }
}

#[tokio::test]
async fn unresolved_identity_does_not_block_public_or_internet_routes() {
    let dead = dead_socket_path();
    for policy in [AccessPolicy::Public, AccessPolicy::Internet] {
        let mut gw = start_gateway(policy, &[], &[], Some(&dead), None).await;
        assert_eq!(
            gw.login("PlayerOne").await,
            LoginOutcome::Proxied,
            "{policy:?}"
        );
    }
}

#[tokio::test]
async fn gateway_without_any_identity_source_is_fail_closed_too() {
    let mut gw = start_gateway(AccessPolicy::Group, &["grp-e2e"], &[], None, None).await;
    assert_refused(gw.login("PlayerOne").await, "verificar sua identidade");
}

#[tokio::test]
async fn dead_whois_socket_and_dead_control_plane_refuse_without_hanging() {
    let dead = dead_socket_path();
    let mut gw = start_gateway(
        AccessPolicy::Group,
        &["grp-e2e"],
        &[],
        Some(&dead),
        Some("http://127.0.0.1:1"),
    )
    .await;

    let started = Instant::now();
    assert_refused(gw.login("PlayerOne").await, "verificar sua identidade");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "a recusa demorou {:?}",
        started.elapsed()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn player_is_refused_on_maintenance_and_admin_passes_using_the_control_plane_role() {
    let control_plane = MockControlPlane::start();
    let url = control_plane.url();

    // O Tailscale diz que o nó é de um jogador com outro nome; quem manda é o PLAYER do Control Plane.
    let player_device = FakeTailscaled::start("2002", "not-the-nick", &["tag:mc-player"]);
    let mut as_player = start_gateway(
        AccessPolicy::Maintenance,
        &[],
        &[],
        Some(&player_device.socket_path),
        Some(&url),
    )
    .await;
    assert_refused(as_player.login("PlayerOne").await, "manutenção");

    // O ADMIN do Control Plane passa, mesmo com o nó marcado como jogador.
    let admin_device = FakeTailscaled::start("1001", "whatever", &["tag:mc-player"]);
    let mut as_admin = start_gateway(
        AccessPolicy::Maintenance,
        &[],
        &[],
        Some(&admin_device.socket_path),
        Some(&url),
    )
    .await;
    assert_eq!(as_admin.login("E2EPlayer").await, LoginOutcome::Proxied);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nickname_of_another_user_is_refused_against_the_control_plane_nick() {
    let control_plane = MockControlPlane::start();
    let device = FakeTailscaled::start("2002", "Mallory", &["tag:mc-player"]);
    let mut gw = start_gateway(
        AccessPolicy::Public,
        &[],
        &[],
        Some(&device.socket_path),
        Some(&control_plane.url()),
    )
    .await;

    assert_refused(gw.login("Mallory").await, "não pertence a este dispositivo");
    assert_eq!(gw.login("PlayerOne").await, LoginOutcome::Proxied);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn group_and_individual_policies_use_control_plane_ids() {
    let control_plane = MockControlPlane::start();
    let device = FakeTailscaled::start("2002", "PlayerOne", &[]);
    let socket = Some(device.socket_path.as_path());
    let url = control_plane.url();

    let mut allowed_group =
        start_gateway(AccessPolicy::Group, &["grp-e2e"], &[], socket, Some(&url)).await;
    assert_eq!(
        allowed_group.login("PlayerOne").await,
        LoginOutcome::Proxied
    );

    let mut other_group =
        start_gateway(AccessPolicy::Group, &["grp-other"], &[], socket, Some(&url)).await;
    assert_refused(other_group.login("PlayerOne").await, "grupos autorizados");

    let mut invited = start_gateway(
        AccessPolicy::Individual,
        &[],
        &["usr-player-1"],
        socket,
        Some(&url),
    )
    .await;
    assert_eq!(invited.login("PlayerOne").await, LoginOutcome::Proxied);

    let mut not_invited = start_gateway(
        AccessPolicy::Individual,
        &[],
        &["usr-someone"],
        socket,
        Some(&url),
    )
    .await;
    assert_refused(
        not_invited.login("PlayerOne").await,
        "convidados específicos",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn falls_back_to_the_control_plane_by_ip_when_the_local_socket_is_down() {
    let control_plane = MockControlPlane::start();
    let dead = dead_socket_path();
    let url = control_plane.url();

    let mut gw = start_gateway(
        AccessPolicy::Individual,
        &[],
        &["usr-ip-only"],
        Some(&dead),
        Some(&url),
    )
    .await;
    assert_eq!(gw.login("IpOnly").await, LoginOutcome::Proxied);
    assert_refused(
        gw.login("PlayerOne").await,
        "não pertence a este dispositivo",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn device_unknown_to_the_control_plane_is_refused_unless_the_route_is_public() {
    let control_plane = MockControlPlane::start();
    let device = FakeTailscaled::start("3003", "Ghost", &["tag:mc-player"]);
    let socket = Some(device.socket_path.as_path());
    let url = control_plane.url();

    let mut restricted =
        start_gateway(AccessPolicy::Group, &["grp-e2e"], &[], socket, Some(&url)).await;
    assert_refused(restricted.login("Ghost").await, "não está registrado");

    let mut public = start_gateway(AccessPolicy::Public, &[], &[], socket, Some(&url)).await;
    assert_eq!(public.login("Ghost").await, LoginOutcome::Proxied);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn whois_alone_still_decides_when_the_control_plane_is_unreachable() {
    let admin_device = FakeTailscaled::start("7", "AdminGuy", &["tag:mc-gateway"]);
    let player_device = FakeTailscaled::start("8", "RegularGuy", &["tag:mc-player"]);
    let unreachable = Some("http://127.0.0.1:1");

    let mut admin = start_gateway(
        AccessPolicy::Maintenance,
        &[],
        &[],
        Some(&admin_device.socket_path),
        unreachable,
    )
    .await;
    assert_eq!(admin.login("AdminGuy").await, LoginOutcome::Proxied);

    let mut player = start_gateway(
        AccessPolicy::Maintenance,
        &[],
        &[],
        Some(&player_device.socket_path),
        unreachable,
    )
    .await;
    assert_refused(player.login("RegularGuy").await, "manutenção");
}
