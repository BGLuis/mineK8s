use minecraft_protocol::packets::status::{
    MotdDescription, PlayerSample, PlayersInfo, ServerStatusResponse, ServerVersionInfo,
};

use crate::routing::{AccessPolicy, CachedServerRoute, ServerInstanceStatus};

/// Gera a resposta de Status (JSON) sintetizada pelo Gateway de acordo com o estado do servidor (RF-GW-09).
/// Se o servidor estiver Stopped, Starting, Provisioning, Stopping, Updating, Crashed, Failed ou sob Manutenção, responde instantaneamente sem I/O upstream.
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
        Some(r) => {
            if r.access_policy == AccessPolicy::Maintenance {
                return ServerStatusResponse {
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
                };
            }

            match r.status {
                ServerInstanceStatus::Provisioning => ServerStatusResponse {
                    version: ServerVersionInfo {
                        name: "§8[§6🛠️ PROVISIONANDO§8]".to_string(),
                        protocol: r.protocol_version,
                    },
                    players: PlayersInfo {
                        max: r.max_players as i32,
                        online: 0,
                        sample: None,
                    },
                    description: MotdDescription::Plain(format!(
                        "§8[§6🛠️ PROVISIONANDO§8] §f{}\n§7Alocando recursos de cluster e volumes...",
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
                ServerInstanceStatus::Stopping => ServerStatusResponse {
                    version: ServerVersionInfo {
                        name: "§8[§c🛑 PARANDO...§8]".to_string(),
                        protocol: r.protocol_version,
                    },
                    players: PlayersInfo {
                        max: 0,
                        online: 0,
                        sample: None,
                    },
                    description: MotdDescription::Plain(format!(
                        "§8[§c🛑 PARANDO...§8] §f{}\n§7Salvando chunks e liberando recursos...",
                        r.name
                    )),
                    favicon: None,
                    enforces_secure_chat: Some(false),
                    previews_chat: None,
                },
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
                ServerInstanceStatus::Updating => ServerStatusResponse {
                    version: ServerVersionInfo {
                        name: "§8[§b🔄 ATUALIZANDO§8]".to_string(),
                        protocol: r.protocol_version,
                    },
                    players: PlayersInfo {
                        max: 0,
                        online: 0,
                        sample: None,
                    },
                    description: MotdDescription::Plain(format!(
                        "§8[§b🔄 ATUALIZANDO§8] §f{}\n§7Atualizando versão e modpacks...",
                        r.name
                    )),
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
                ServerInstanceStatus::Failed => ServerStatusResponse {
                    version: ServerVersionInfo {
                        name: "§8[§4⚠️ ERRO DE INFRA§8]".to_string(),
                        protocol: r.protocol_version,
                    },
                    players: PlayersInfo {
                        max: 0,
                        online: 0,
                        sample: None,
                    },
                    description: MotdDescription::Plain(format!(
                        "§8[§4⚠️ ERRO DE INFRA§8] §f{}\n§7Falha crítica de infraestrutura/armazenamento.",
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
            }
        }
    }
}
