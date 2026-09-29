use minecraft_protocol::packets::status::{
    MotdDescription, PlayerSample, PlayersInfo, ServerStatusResponse, ServerVersionInfo,
};

use crate::routing::{CachedServerRoute, ServerInstanceStatus};

/// Gera a resposta de Status (JSON) sintetizada pelo Gateway de acordo com o estado do servidor (RF-GW-09).
/// Se o servidor estiver Stopped, Starting, Maintenance ou não existir, responde instantaneamente sem I/O upstream.
pub fn build_synthetic_status(route: Option<&CachedServerRoute>) -> ServerStatusResponse {
    match route {
        None => ServerStatusResponse {
            version: ServerVersionInfo {
                name: "§cMineKubernetes".to_string(),
                protocol: 765,
            },
            players: PlayersInfo {
                max: 0,
                online: 0,
                sample: None,
            },
            description: MotdDescription::Plain(
                "§c❌ Servidor não encontrado no MineKubernetes.\n§7Verifique o subdomínio ou contate o administrador.".to_string(),
            ),
            favicon: None,
            enforces_secure_chat: Some(false),
            previews_chat: None,
        },
        Some(r) => match r.status {
            ServerInstanceStatus::Stopped => ServerStatusResponse {
                version: ServerVersionInfo {
                    name: "§aMineKubernetes §7[1.20.x]".to_string(),
                    protocol: r.protocol_version,
                },
                players: PlayersInfo {
                    max: r.max_players as i32,
                    online: 0,
                    sample: Some(vec![PlayerSample {
                        name: "§7[Clique para Conectar e Acordar]".to_string(),
                        id: "00000000-0000-0000-0000-000000000000".to_string(),
                    }]),
                },
                description: MotdDescription::Plain(format!(
                    "§8[§c💤 HIBERNANDO§8] §f{}\n§7Clique duas vezes para acordar o servidor.",
                    r.name
                )),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            },
            ServerInstanceStatus::Starting => ServerStatusResponse {
                version: ServerVersionInfo {
                    name: "§8[§e⏳ INICIANDO...§8]".to_string(),
                    protocol: r.protocol_version,
                },
                players: PlayersInfo {
                    max: r.max_players as i32,
                    online: 0,
                    sample: None,
                },
                description: MotdDescription::Plain(format!(
                    "§8[§e⏳ INICIANDO...§8] §f{}\n§6Carregando chunks e mods. Aguarde alguns instantes...",
                    r.name
                )),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            },
            ServerInstanceStatus::Maintenance => ServerStatusResponse {
                version: ServerVersionInfo {
                    name: "§8[§4⛔ MANUTENÇÃO§8]".to_string(),
                    protocol: r.protocol_version,
                },
                players: PlayersInfo {
                    max: 0,
                    online: 0,
                    sample: None,
                },
                description: MotdDescription::Plain(
                    "§8[§4⛔ MANUTENÇÃO§8] §cServidor Temporariamente Fechado\n§7Apenas operadores autorizados podem acessar.".to_string(),
                ),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            },
            ServerInstanceStatus::Crashed => ServerStatusResponse {
                version: ServerVersionInfo {
                    name: "§8[§c💥 FALHA§8]".to_string(),
                    protocol: r.protocol_version,
                },
                players: PlayersInfo {
                    max: 0,
                    online: 0,
                    sample: None,
                },
                description: MotdDescription::Plain(format!(
                    "§8[§c💥 FALHA§8] §f{}\n§7A instância encerrou inesperadamente.",
                    r.name
                )),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            },
            ServerInstanceStatus::Ready => ServerStatusResponse {
                version: ServerVersionInfo {
                    name: "§aMineKubernetes §7[Online]".to_string(),
                    protocol: r.protocol_version,
                },
                players: PlayersInfo {
                    max: r.max_players as i32,
                    online: 0,
                    sample: None,
                },
                description: MotdDescription::Plain(format!("§aOnline: {}", r.name)),
                favicon: None,
                enforces_secure_chat: Some(false),
                previews_chat: None,
            },
        },
    }
}
