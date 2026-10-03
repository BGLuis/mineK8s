use std::net::IpAddr;
use std::time::Instant;
use tokio::sync::oneshot;
use uuid::Uuid;

/// Handle para gerenciamento do ciclo de vida de uma sessão ativa de jogador (GW:161-171).
pub struct ActiveSessionHandle {
    pub session_id: Uuid,
    pub client_ip: IpAddr,
    pub subdomain: String,
    pub server_id: String,
    pub minecraft_nick: String,
    pub connected_at: Instant,
    /// Início da sessão em epoch ms, para reanunciá-la ao Control Plane após uma reconexão.
    pub connected_at_epoch_ms: i64,
    pub abort_tx: Option<oneshot::Sender<()>>,
}
