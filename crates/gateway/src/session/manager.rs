use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;
use dashmap::DashMap;
use tokio::sync::oneshot;
use tracing::info;
use uuid::Uuid;

use crate::session::handle::ActiveSessionHandle;

/// Gerenciador concorrente de sessões de jogadores conectados ao Gateway (RF-GW-13, GW:161-171).
#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<DashMap<Uuid, ActiveSessionHandle>>,
    nick_index: Arc<DashMap<(String, String), Uuid>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registra uma nova sessão de jogo ativa no Gateway.
    /// Se houver uma sessão prévia com o mesmo nick no mesmo servidor, efetua o despejo forçado (RF-GW-13).
    pub fn register_session(
        &self,
        client_ip: IpAddr,
        subdomain: String,
        server_id: String,
        minecraft_nick: String,
    ) -> (Uuid, oneshot::Receiver<()>) {
        let session_id = Uuid::new_v4();
        let (abort_tx, abort_rx) = oneshot::channel();

        // RF-GW-13: Despejo da sessão anterior com o mesmo nick (anti-cloning / anti-ghost)
        let nick_key = (server_id.clone(), minecraft_nick.clone());
        if let Some((_, old_session_id)) = self.nick_index.remove(&nick_key) {
            if let Some((_, mut old_handle)) = self.sessions.remove(&old_session_id) {
                info!(
                    nick = %minecraft_nick,
                    server = %server_id,
                    old_id = %old_session_id,
                    "Despejando sessão anterior clonada por nova conexão do mesmo jogador (RF-GW-13)"
                );
                if let Some(tx) = old_handle.abort_tx.take() {
                    let _ = tx.send(());
                }
            }
        }

        let handle = ActiveSessionHandle {
            session_id,
            client_ip,
            subdomain,
            server_id,
            minecraft_nick,
            connected_at: Instant::now(),
            abort_tx: Some(abort_tx),
        };

        self.sessions.insert(session_id, handle);
        self.nick_index.insert(nick_key, session_id);

        (session_id, abort_rx)
    }

    /// Remove a sessão do mapa de sessões ativas (Critério de Aceite da Issue #53, GW:153-154).
    pub fn remove_session(&self, session_id: &Uuid) -> Option<ActiveSessionHandle> {
        if let Some((_, handle)) = self.sessions.remove(session_id) {
            let nick_key = (handle.server_id.clone(), handle.minecraft_nick.clone());
            self.nick_index.remove_if(&nick_key, |_, id| id == session_id);
            Some(handle)
        } else {
            None
        }
    }

    pub fn active_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn is_session_active(&self, session_id: &Uuid) -> bool {
        self.sessions.contains_key(session_id)
    }
}
