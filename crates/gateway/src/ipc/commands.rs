use std::net::IpAddr;

use tracing::info;

use crate::ipc::protocol::{
    GatewayCommand, GatewayCommandResult, RevokeSessionRequest, RevokeSessionResponse,
};
use crate::session::SessionManager;

/// Executa um comando do Control Plane sobre as sessões e monta o resultado com o mesmo `command_id`.
pub fn execute_command(sessions: &SessionManager, command: GatewayCommand) -> GatewayCommandResult {
    let mut result = GatewayCommandResult {
        command_id: command.command_id,
        ..Default::default()
    };
    match command.revoke_session {
        Some(request) => match revoke_sessions(sessions, &request) {
            Ok(response) => result.revoke_session = Some(response),
            Err(message) => result.error = message,
        },
        None => result.error = "comando sem carga conhecida".into(),
    }
    result
}

fn revoke_sessions(
    sessions: &SessionManager,
    request: &RevokeSessionRequest,
) -> Result<RevokeSessionResponse, String> {
    let terminated = if !request.client_ip.is_empty() {
        let ip: IpAddr = request
            .client_ip
            .parse()
            .map_err(|_| format!("client_ip inválido: {}", request.client_ip))?;
        sessions.revoke_ip_sessions(ip)
    } else if !request.minecraft_nick.is_empty() {
        let server_id = Some(request.server_id.as_str()).filter(|id| !id.is_empty());
        sessions.revoke_player_sessions(server_id, &request.minecraft_nick)
    } else {
        return Err("a revogação exige client_ip ou minecraft_nick".into());
    };

    info!(
        terminated,
        server_id = %request.server_id,
        client_ip = %request.client_ip,
        nick = %request.minecraft_nick,
        reason = %request.reason_message,
        "Sessões revogadas por comando do Control Plane"
    );
    Ok(RevokeSessionResponse {
        session_found: terminated > 0,
        terminated_connections_count: terminated as i32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn revoke(server_id: &str, client_ip: &str, nick: &str) -> GatewayCommand {
        GatewayCommand {
            command_id: "cmd-1".into(),
            revoke_session: Some(RevokeSessionRequest {
                server_id: server_id.into(),
                client_ip: client_ip.into(),
                minecraft_nick: nick.into(),
                reason_message: String::new(),
            }),
        }
    }

    fn open(
        sessions: &SessionManager,
        ip: &str,
        server: &str,
        nick: &str,
    ) -> tokio::sync::oneshot::Receiver<()> {
        sessions
            .register_session(
                ip.parse().unwrap(),
                "s.mine.lan".into(),
                server.into(),
                nick.into(),
            )
            .1
    }

    #[tokio::test]
    async fn nick_with_server_kicks_only_that_servers_session() {
        let sessions = SessionManager::new();
        let mut survival = open(&sessions, "100.64.0.5", "srv-survival", "Steve");
        let mut creative = open(&sessions, "100.64.0.5", "srv-creative", "Steve");

        let result = execute_command(&sessions, revoke("srv-survival", "", "steve"));

        assert_eq!(result.command_id, "cmd-1");
        assert_eq!(result.error, "");
        let response = result.revoke_session.unwrap();
        assert!(response.session_found);
        assert_eq!(response.terminated_connections_count, 1);
        assert!(survival.try_recv().is_ok());
        assert!(creative.try_recv().is_err());
    }

    #[tokio::test]
    async fn nick_without_server_kicks_every_server() {
        let sessions = SessionManager::new();
        let _a = open(&sessions, "100.64.0.5", "srv-survival", "Steve");
        let _b = open(&sessions, "100.64.0.5", "srv-creative", "Steve");
        let _other = open(&sessions, "100.64.0.6", "srv-survival", "Alex");

        let response = execute_command(&sessions, revoke("", "", "Steve"))
            .revoke_session
            .unwrap();

        assert_eq!(response.terminated_connections_count, 2);
        assert_eq!(sessions.active_count(), 1);
    }

    #[tokio::test]
    async fn client_ip_kicks_every_session_of_the_ip_whatever_the_nick() {
        let sessions = SessionManager::new();
        let mut steve = open(&sessions, "100.64.0.5", "srv-survival", "Steve");
        let mut alt = open(&sessions, "100.64.0.5", "srv-creative", "SteveAlt");
        let mut other_ip = open(&sessions, "100.64.0.6", "srv-survival", "Alex");

        let response = execute_command(&sessions, revoke("srv-survival", "100.64.0.5", ""))
            .revoke_session
            .unwrap();

        assert_eq!(response.terminated_connections_count, 2);
        assert!(steve.try_recv().is_ok());
        assert!(alt.try_recv().is_ok());
        assert!(other_ip.try_recv().is_err());
    }

    #[tokio::test]
    async fn no_matching_session_reports_zero_not_found() {
        let sessions = SessionManager::new();
        let _alex = open(&sessions, "100.64.0.6", "srv-survival", "Alex");

        let by_nick = execute_command(&sessions, revoke("srv-survival", "", "Ghost"))
            .revoke_session
            .unwrap();
        let by_ip = execute_command(&sessions, revoke("", "100.64.0.99", ""))
            .revoke_session
            .unwrap();

        for response in [by_nick, by_ip] {
            assert!(!response.session_found);
            assert_eq!(response.terminated_connections_count, 0);
        }
        assert_eq!(sessions.active_count(), 1);
    }

    #[tokio::test]
    async fn malformed_commands_fail_with_an_error_and_touch_nothing() {
        let sessions = SessionManager::new();
        let _alex = open(&sessions, "100.64.0.6", "srv-survival", "Alex");

        let bad_ip = execute_command(&sessions, revoke("", "not-an-ip", ""));
        let no_target = execute_command(&sessions, revoke("srv-survival", "", ""));
        let empty = execute_command(
            &sessions,
            GatewayCommand {
                command_id: "cmd-2".into(),
                revoke_session: None,
            },
        );

        assert!(bad_ip.error.contains("client_ip inválido") && bad_ip.revoke_session.is_none());
        assert!(
            no_target.error.contains("client_ip ou minecraft_nick")
                && no_target.revoke_session.is_none()
        );
        assert_eq!(empty.command_id, "cmd-2");
        assert!(!empty.error.is_empty());
        assert_eq!(sessions.active_count(), 1);
    }
}
