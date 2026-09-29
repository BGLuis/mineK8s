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

    /// Executa o Smart Kick de sessões ativas do jogador (RF-GW-15, RF-TS-09).
    /// Se `server_id` for fornecido, revoga apenas a sessão naquele servidor.
    /// Se `server_id` for None, revoga todas as sessões ativas com o nickname (ex.: Ban de Rede).
    pub fn revoke_player_sessions(
        &self,
        server_id: Option<&str>,
        minecraft_nick: &str,
    ) -> usize {
        let mut terminated = 0;
        let mut sessions_to_kill = Vec::new();

        for entry in self.sessions.iter() {
            let handle = entry.value();
            if handle.minecraft_nick.eq_ignore_ascii_case(minecraft_nick) {
                if let Some(srv) = server_id {
                    if handle.server_id == srv {
                        sessions_to_kill.push(*entry.key());
                    }
                } else {
                    sessions_to_kill.push(*entry.key());
                }
            }
        }

        for session_id in sessions_to_kill {
            if let Some(mut handle) = self.remove_session(&session_id) {
                if let Some(tx) = handle.abort_tx.take() {
                    let _ = tx.send(());
                    terminated += 1;
                }
            }
        }

        terminated
    }

    /// Revoga todas as conexões ativas associadas a um endereço IP específico (RF-TS-09 Ban de Rede).
    pub fn revoke_ip_sessions(&self, client_ip: IpAddr) -> usize {
        let mut terminated = 0;
        let mut sessions_to_kill = Vec::new();

        for entry in self.sessions.iter() {
            if entry.value().client_ip == client_ip {
                sessions_to_kill.push(*entry.key());
            }
        }

        for session_id in sessions_to_kill {
            if let Some(mut handle) = self.remove_session(&session_id) {
                if let Some(tx) = handle.abort_tx.take() {
                    let _ = tx.send(());
                    terminated += 1;
                }
            }
        }

        terminated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_smart_kick_oneshot_revocation() {
        let manager = SessionManager::new();
        let ip: IpAddr = "100.64.0.10".parse().unwrap();

        let (sess1, mut abort1) = manager.register_session(
            ip,
            "survival.mine.lan".into(),
            "srv-survival".into(),
            "LucasCraft".into(),
        );

        let (sess2, mut abort2) = manager.register_session(
            ip,
            "creative.mine.lan".into(),
            "srv-creative".into(),
            "OutroPlayer".into(),
        );

        assert_eq!(manager.active_count(), 2);

        // Smart Kick apenas no servidor srv-survival para LucasCraft
        let kicked = manager.revoke_player_sessions(Some("srv-survival"), "LucasCraft");
        assert_eq!(kicked, 1);
        assert!(!manager.is_session_active(&sess1));
        assert!(manager.is_session_active(&sess2));

        // Verifica que o oneshot abort_rx foi disparado
        assert!(abort1.try_recv().is_ok());
        assert!(abort2.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_network_ban_ip_revocation() {
        let manager = SessionManager::new();
        let ip: IpAddr = "100.64.0.25".parse().unwrap();
        let other_ip: IpAddr = "100.64.0.99".parse().unwrap();

        let (sess1, mut abort1) = manager.register_session(
            ip,
            "survival.mine.lan".into(),
            "srv-survival".into(),
            "PlayerA".into(),
        );

        let (sess2, mut abort2) = manager.register_session(
            other_ip,
            "survival.mine.lan".into(),
            "srv-survival".into(),
            "PlayerB".into(),
        );

        let kicked = manager.revoke_ip_sessions(ip);
        assert_eq!(kicked, 1);
        assert!(!manager.is_session_active(&sess1));
        assert!(manager.is_session_active(&sess2));

        assert!(abort1.try_recv().is_ok());
        assert!(abort2.try_recv().is_err());
    }
}
