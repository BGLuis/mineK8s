use std::io::{BufRead, BufReader};
use std::net::IpAddr;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use gateway::ipc::run_control_plane_link;
use gateway::routing::RouteTable;
use gateway::session::SessionManager;
use tokio::sync::{mpsc, watch};

/// Servidor gRPC do Control Plane simulado em Node; cada StreamSessionEvents recebido vira uma linha SESSION_EVENT.
struct MockControlPlane {
    child: Child,
    port: u16,
    lines: std_mpsc::Receiver<String>,
}

impl MockControlPlane {
    fn start() -> Self {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let mut child = Command::new("node")
            .env(
                "NODE_PATH",
                format!("{}/../../services/control-plane/node_modules", manifest_dir),
            )
            .arg(format!(
                "{}/tests/fixtures/mock_grpc_server.js",
                manifest_dir
            ))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Falha ao iniciar o servidor gRPC simulado");

        let stdout = child.stdout.take().expect("stdout não capturável");
        let (tx, lines) = std_mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        let port = loop {
            let line = lines
                .recv_timeout(Duration::from_secs(10))
                .expect("Servidor simulado não reportou a porta");
            if let Some(port) = line.strip_prefix("READY_PORT:") {
                break port.trim().parse().unwrap();
            }
        };
        Self { child, port, lines }
    }

    /// Próxima linha SESSION_EVENT, sem o prefixo.
    fn next_session_event(&self) -> String {
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(10))
                .expect("Evento de sessão não chegou ao Control Plane simulado");
            if let Some(event) = line.strip_prefix("SESSION_EVENT:") {
                return event.to_string();
            }
        }
    }
}

impl Drop for MockControlPlane {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_link_syncs_routes_and_publishes_session_and_wake_events() {
    let control_plane = MockControlPlane::start();
    let ip: IpAddr = "100.64.0.7".parse().unwrap();

    let (session_tx, session_rx) = mpsc::unbounded_channel();
    let (wake_tx, wake_rx) = mpsc::unbounded_channel::<String>();
    let sessions = SessionManager::new().with_event_sender(session_tx.clone());
    let route_table = RouteTable::new();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Uma sessão aberta antes do link existir deve ser anunciada assim que ele conectar.
    let (early_id, _early_abort) = sessions.register_session(
        ip,
        "e2e.mine.lan".into(),
        "srv-e2e-live".into(),
        "Early".into(),
    );

    let link = tokio::spawn(run_control_plane_link(
        format!("http://127.0.0.1:{}", control_plane.port),
        route_table.clone(),
        sessions.clone(),
        session_tx,
        session_rx,
        wake_rx,
        shutdown_rx,
    ));

    assert_eq!(
        control_plane.next_session_event(),
        "CONNECTED:srv-e2e-live:Early:100.64.0.7",
        "a sessão aberta antes da conexão deve ser reanunciada"
    );

    // O snapshot do Control Plane popula a tabela de rotas do Gateway.
    tokio::time::timeout(Duration::from_secs(5), async {
        while route_table
            .lookup_virtual_host(25565, "e2e.mine.lan")
            .is_none()
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("o snapshot deveria popular a tabela de rotas");

    // Sessões novas e encerradas viram CONNECTED / DISCONNECTED.
    let (steve_id, _steve_abort) = sessions.register_session(
        ip,
        "e2e.mine.lan".into(),
        "srv-e2e-live".into(),
        "Steve".into(),
    );
    assert_eq!(
        control_plane.next_session_event(),
        "CONNECTED:srv-e2e-live:Steve:100.64.0.7"
    );
    sessions.remove_session(&steve_id);
    assert_eq!(
        control_plane.next_session_event(),
        "DISCONNECTED:srv-e2e-live:Steve:100.64.0.7"
    );

    // O pedido de auto-wake do servidor vira WAKE_REQUESTED.
    wake_tx.send("srv-e2e-live".into()).unwrap();
    assert_eq!(
        control_plane.next_session_event(),
        "WAKE_REQUESTED:srv-e2e-live::"
    );

    sessions.remove_session(&early_id);
    shutdown_tx.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(5), link)
        .await
        .expect("o link deve encerrar com o shutdown")
        .unwrap();
}
