use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tracing::{info, warn};

use crate::ipc::client::GatewayIpcClient;
use crate::ipc::protocol::{SessionEventType, SessionLifecycleEvent};
use crate::routing::RouteTable;
use crate::session::SessionManager;

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Pedido de auto-wake como evento de sessão: o Control Plane reage a WAKE_REQUESTED subindo o pod.
pub fn wake_event(server_id: String) -> SessionLifecycleEvent {
    SessionLifecycleEvent {
        event_type: SessionEventType::WakeRequested as i32,
        session_id: String::new(),
        server_id,
        client_ip: String::new(),
        minecraft_nick: String::new(),
        timestamp_epoch_ms: now_epoch_ms(),
        reason: "auto-wake".into(),
    }
}

/// Liga o Gateway ao Control Plane: sincroniza rotas, publica eventos de sessão, repassa pedidos de wake
/// e executa os comandos de revogação de sessão.
///
/// O Gateway continua atendendo mesmo com o Control Plane fora do ar; a conexão inicial é tentada
/// de novo a cada 3 s e os dois loops reconectam sozinhos depois.
pub async fn run_control_plane_link(
    endpoint: String,
    route_table: RouteTable,
    sessions: SessionManager,
    events_tx: mpsc::UnboundedSender<SessionLifecycleEvent>,
    events_rx: mpsc::UnboundedReceiver<SessionLifecycleEvent>,
    mut wake_rx: mpsc::UnboundedReceiver<String>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let wake_bridge = tokio::spawn(async move {
        while let Some(server_id) = wake_rx.recv().await {
            let _ = events_tx.send(wake_event(server_id));
        }
    });

    let client = loop {
        if *shutdown_rx.borrow() {
            wake_bridge.abort();
            return;
        }
        match GatewayIpcClient::connect(endpoint.clone()).await {
            Ok(client) => break client,
            Err(e) => {
                warn!(endpoint = %endpoint, error = %e, "Control Plane indisponível. Nova tentativa em 3s...");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(3)) => {},
                    _ = shutdown_rx.changed() => {},
                }
            }
        }
    };
    info!(endpoint = %endpoint, "Conectado ao Control Plane via gRPC");

    tokio::join!(
        client
            .clone()
            .run_sync_loop(route_table, shutdown_rx.clone()),
        client
            .clone()
            .run_commands_loop(sessions.clone(), shutdown_rx.clone()),
        client.run_session_events_loop(sessions, events_rx, shutdown_rx),
    );
    wake_bridge.abort();
}
