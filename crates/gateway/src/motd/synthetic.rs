use minecraft_protocol::packets::status::{
    MotdDescription, PlayerSample, PlayersInfo, ServerStatusResponse, ServerVersionInfo,
};

use crate::messages::{status_text, Language, StatusKind};
use crate::routing::{AccessPolicy, CachedServerRoute, ServerInstanceStatus};

const NIL_UUID: &str = "00000000-0000-0000-0000-000000000000";

/// Gera a resposta de Status (JSON) sintetizada pelo Gateway de acordo com o estado do servidor (RF-GW-09).
/// Se o servidor estiver Stopped, Starting, Provisioning, Stopping, Updating, Crashed, Failed ou sob Manutenção, responde instantaneamente sem I/O upstream.
///
/// `client_protocol` é o protocolo que o cliente declarou no handshake: devolvê-lo evita que o cliente
/// marque o mundo como "versão incompatível" só porque o gateway fala por um servidor que dorme.
pub fn build_synthetic_status(
    route: Option<&CachedServerRoute>,
    client_protocol: i32,
) -> ServerStatusResponse {
    let Some(route) = route else {
        return response(
            StatusKind::NotFound,
            Language::default(),
            "",
            client_protocol,
            0,
            None,
        );
    };

    let kind = if route.access_policy == AccessPolicy::Maintenance {
        StatusKind::Maintenance
    } else {
        match route.status {
            ServerInstanceStatus::Provisioning => StatusKind::Provisioning,
            ServerInstanceStatus::Starting => StatusKind::Starting,
            ServerInstanceStatus::Stopping => StatusKind::Stopping,
            ServerInstanceStatus::Stopped => StatusKind::Stopped,
            ServerInstanceStatus::Updating => StatusKind::Updating,
            ServerInstanceStatus::Crashed => StatusKind::Crashed,
            ServerInstanceStatus::Failed => StatusKind::Failed,
            ServerInstanceStatus::Ready => StatusKind::Ready,
        }
    };
    response(
        kind,
        route.language,
        &route.name,
        client_protocol,
        route.max_players as i32,
        route.favicon.clone(),
    )
}

fn response(
    kind: StatusKind,
    language: Language,
    world: &str,
    client_protocol: i32,
    max_players: i32,
    favicon: Option<String>,
) -> ServerStatusResponse {
    let text = status_text(kind, language, world);
    // O contador só faz sentido quando o mundo pode receber jogadores ou está para receber.
    let shows_capacity = matches!(
        kind,
        StatusKind::Provisioning | StatusKind::Starting | StatusKind::Stopped | StatusKind::Ready
    );

    ServerStatusResponse {
        version: ServerVersionInfo {
            name: text.version,
            protocol: client_protocol,
        },
        players: PlayersInfo {
            max: if shows_capacity { max_players } else { 0 },
            online: 0,
            sample: text.hint.map(|name| {
                vec![PlayerSample {
                    name,
                    id: NIL_UUID.to_string(),
                }]
            }),
        },
        description: MotdDescription::Plain(text.motd),
        favicon,
        enforces_secure_chat: Some(false),
        previews_chat: None,
    }
}
