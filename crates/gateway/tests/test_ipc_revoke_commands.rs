mod common;

use std::net::IpAddr;
use std::time::Duration;

use common::MockControlPlane;
use gateway::ipc::run_control_plane_link;
use gateway::routing::RouteTable;
use gateway::session::SessionManager;
use tokio::sync::{mpsc, oneshot, watch};

fn open_session(
    sessions: &SessionManager,
    ip: &str,
    server: &str,
    nick: &str,
) -> oneshot::Receiver<()> {
    let ip: IpAddr = ip.parse().unwrap();
    sessions
        .register_session(ip, "world.mine.lan".into(), server.into(), nick.into())
        .1
}

/// O Control Plane manda o comando pelo stream aberto pelo Gateway e recebe a contagem real de volta.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn revoke_commands_from_the_control_plane_drop_real_sessions_and_report_the_count() {
    let mut control_plane = MockControlPlane::start();

    let (session_tx, session_rx) = mpsc::unbounded_channel();
    let (_wake_tx, wake_rx) = mpsc::unbounded_channel::<String>();
    let sessions = SessionManager::new().with_event_sender(session_tx.clone());
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let mut survival = open_session(&sessions, "100.64.0.5", "srv-survival", "Steve");
    let mut creative = open_session(&sessions, "100.64.0.5", "srv-creative", "Steve");
    let mut other_player = open_session(&sessions, "100.64.0.6", "srv-survival", "Alex");

    let link = tokio::spawn(run_control_plane_link(
        control_plane.url(),
        RouteTable::new(),
        sessions.clone(),
        session_tx,
        session_rx,
        wake_rx,
        shutdown_rx,
    ));
    control_plane.next_line("COMMANDS_CONNECTED");

    // Smart Kick: só a sessão do servidor indicado.
    control_plane.send_line("REVOKE:srv-survival::Steve");
    let id = control_plane.next_line("COMMAND_SENT:");
    assert_eq!(
        control_plane.next_line("COMMAND_RESULT:"),
        format!("{id}:true:1:")
    );
    assert!(survival.try_recv().is_ok());
    assert!(
        creative.try_recv().is_err(),
        "a sessão em outro servidor não pode cair"
    );
    assert!(other_player.try_recv().is_err());
    assert_eq!(sessions.active_count(), 2);

    // Ban de rede: todas as sessões do IP, em qualquer servidor.
    let mut second_session = open_session(&sessions, "100.64.0.5", "srv-survival", "SteveAlt");
    control_plane.send_line("REVOKE::100.64.0.5:");
    let id = control_plane.next_line("COMMAND_SENT:");
    assert_eq!(
        control_plane.next_line("COMMAND_RESULT:"),
        format!("{id}:true:2:")
    );
    assert!(creative.try_recv().is_ok());
    assert!(second_session.try_recv().is_ok());
    assert!(other_player.try_recv().is_err(), "outro IP não pode cair");

    // Sem sessão correspondente a contagem é 0, não um sucesso falso.
    control_plane.send_line("REVOKE:srv-survival::Ghost");
    let id = control_plane.next_line("COMMAND_SENT:");
    assert_eq!(
        control_plane.next_line("COMMAND_RESULT:"),
        format!("{id}:false:0:")
    );
    assert_eq!(sessions.active_count(), 1);

    // Comando inválido volta como erro, sem derrubar ninguém.
    control_plane.send_line("REVOKE:srv-survival::");
    let id = control_plane.next_line("COMMAND_SENT:");
    let result = control_plane.next_line("COMMAND_RESULT:");
    assert!(
        result.starts_with(&format!("{id}:none:none:"))
            && result.contains("client_ip ou minecraft_nick")
    );
    assert_eq!(sessions.active_count(), 1);

    shutdown_tx.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(5), link)
        .await
        .expect("o link deve encerrar com o shutdown")
        .unwrap();
}
