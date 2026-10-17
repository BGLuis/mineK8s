use std::net::IpAddr;
use std::time::Duration;
use tracing::{debug, warn};

use crate::identity::tailscale_local::{TailscaleLocalWhoIs, WhoIsIdentity};
use crate::ipc::GatewayIpcClient;

/// Um login não pode esperar o prazo de 10 s das chamadas simples quando o Control Plane está fora do ar.
const CONTROL_PLANE_TIMEOUT: Duration = Duration::from_secs(3);

/// Quem é o jogador por trás do IP: o que a decisão de acesso e a checagem de nickname consomem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerIdentity {
    pub user_id: String,
    pub registered_nick: String,
    pub role: String,
    pub group_ids: Vec<String>,
    pub is_active: bool,
}

/// Resultado de resolver o IP do cliente. Só `Resolved` autoriza avaliar a política de acesso.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityLookup {
    Resolved(PlayerIdentity),
    /// O Control Plane respondeu e não conhece o dispositivo/usuário.
    Unregistered,
    /// Nenhuma fonte respondeu (ou nenhuma está configurada).
    Unavailable,
}

/// Resolve o IP de origem na identidade do jogador (RF-GW-08, RF-TS-14).
///
/// O WhoIs local do `tailscaled` identifica o dispositivo (usuário e nó Tailscale), mas role, grupos e
/// nickname vivem no Control Plane, então ele é a fonte autoritativa sempre que responde. Sem resposta do
/// Control Plane, a identidade vem só do WhoIs local; sem nenhum dos dois, o IP fica não resolvido.
#[derive(Clone, Default)]
pub struct IdentityResolver {
    whois: Option<TailscaleLocalWhoIs>,
    control_plane: Option<GatewayIpcClient>,
}

impl IdentityResolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_whois(mut self, whois: TailscaleLocalWhoIs) -> Self {
        self.whois = Some(whois);
        self
    }

    pub fn with_control_plane(mut self, client: GatewayIpcClient) -> Self {
        self.control_plane = Some(client);
        self
    }

    pub async fn resolve(&self, client_ip: IpAddr, minecraft_nick: Option<&str>) -> IdentityLookup {
        let ip = client_ip.to_string();
        let nick = minecraft_nick.unwrap_or("");

        let local = match &self.whois {
            Some(whois) => match whois.query_whois(&ip).await {
                Ok(identity) => identity,
                Err(err) => {
                    debug!(ip = %ip, error = %err, "WhoIs local indisponível");
                    None
                }
            },
            None => None,
        };

        if let Some(client) = &self.control_plane {
            let (tailscale_user_id, node_id) = local
                .as_ref()
                .map(|id| (id.user_id.as_str(), id.node_id.as_str()))
                .unwrap_or(("", ""));
            let mut client = client.clone();
            let lookup = tokio::time::timeout(
                CONTROL_PLANE_TIMEOUT,
                client.resolve_player_identity(tailscale_user_id, node_id, &ip, nick),
            )
            .await;
            match lookup {
                Ok(Ok(Some(resp))) => {
                    return IdentityLookup::Resolved(PlayerIdentity {
                        user_id: resp.user_id,
                        registered_nick: resp.minecraft_nick,
                        role: resp.role,
                        group_ids: resp.group_ids,
                        is_active: resp.is_active,
                    });
                }
                Ok(Ok(None)) => return IdentityLookup::Unregistered,
                Ok(Err(err)) => {
                    warn!(ip = %ip, error = %err, "ResolvePlayerIdentity falhou; usando só o WhoIs local, se houver");
                }
                Err(_) => {
                    warn!(ip = %ip, "ResolvePlayerIdentity excedeu o prazo; usando só o WhoIs local, se houver");
                }
            }
        }

        match local {
            Some(identity) => IdentityLookup::Resolved(identity_from_whois(identity)),
            None => IdentityLookup::Unavailable,
        }
    }
}

/// Sem o Control Plane o gateway só sabe o que o Tailscale diz: o nome do perfil faz as vezes de
/// nickname, as tags do nó viram grupos e um nó com tag de gateway ou admin da tailnet é ADMIN.
fn identity_from_whois(identity: WhoIsIdentity) -> PlayerIdentity {
    let is_admin = identity
        .tags
        .iter()
        .any(|t| t == "tag:mc-gateway" || t == "autogroup:admin");
    let registered_nick = if identity.display_name.is_empty() {
        identity.login_name
    } else {
        identity.display_name
    };
    PlayerIdentity {
        user_id: identity.user_id,
        registered_nick,
        role: if is_admin { "ADMIN" } else { "PLAYER" }.into(),
        group_ids: identity.tags,
        is_active: true,
    }
}
