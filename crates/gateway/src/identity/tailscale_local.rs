use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tracing::{debug, warn};

use crate::ipc::GatewayIpcClient;

/// Resposta do endpoint LocalAPI WhoIs do Tailscale.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TailscaleWhoIsResponse {
    #[serde(rename = "Node", default)]
    pub node: Option<TailscaleNode>,
    #[serde(rename = "UserProfile", default)]
    pub user_profile: Option<TailscaleUserProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TailscaleNode {
    #[serde(rename = "ID", default)]
    pub id: i64,
    #[serde(rename = "StableID", default)]
    pub stable_id: String,
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "User", default)]
    pub user: i64,
    #[serde(rename = "Addresses", default)]
    pub addresses: Vec<String>,
    #[serde(rename = "Tags", default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TailscaleUserProfile {
    #[serde(rename = "ID", default)]
    pub id: i64,
    #[serde(rename = "LoginName", default)]
    pub login_name: String,
    #[serde(rename = "DisplayName", default)]
    pub display_name: String,
}

/// Identidade resolvida de um jogador através da rede Tailscale.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WhoIsIdentity {
    pub user_id: String,
    pub login_name: String,
    pub display_name: String,
    pub node_id: String,
    pub tags: Vec<String>,
    pub client_ip: String,
}

/// Cache concorrente em memória com TTL padronizado para consultas WhoIs (RF-GW-08).
#[derive(Clone)]
pub struct WhoIsCache {
    cache: Arc<DashMap<String, (WhoIsIdentity, Instant)>>,
    ttl: Duration,
}

impl WhoIsCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            cache: Arc::new(DashMap::new()),
            ttl,
        }
    }

    pub fn get(&self, ip: &str) -> Option<WhoIsIdentity> {
        if let Some(entry) = self.cache.get(ip) {
            let (identity, created) = entry.value();
            if created.elapsed() <= self.ttl {
                return Some(identity.clone());
            }
        }
        None
    }

    pub fn insert(&self, ip: String, identity: WhoIsIdentity) {
        self.cache.insert(ip, (identity, Instant::now()));
    }

    pub fn invalidate(&self, ip: &str) {
        self.cache.remove(ip);
    }

    pub fn clear(&self) {
        self.cache.clear();
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }
}

impl Default for WhoIsCache {
    fn default() -> Self {
        Self::new(Duration::from_secs(120))
    }
}

/// Driver assíncrono para comunicação com a LocalAPI do Tailscale daemon local via Unix Domain Socket.
#[derive(Clone)]
pub struct TailscaleLocalWhoIs {
    socket_path: PathBuf,
    cache: WhoIsCache,
}

impl TailscaleLocalWhoIs {
    pub fn new(socket_path: impl Into<PathBuf>) -> Self {
        Self {
            socket_path: socket_path.into(),
            cache: WhoIsCache::default(),
        }
    }

    pub fn with_cache_ttl(mut self, ttl: Duration) -> Self {
        self.cache = WhoIsCache::new(ttl);
        self
    }

    pub fn cache(&self) -> &WhoIsCache {
        &self.cache
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Consulta a LocalAPI do Tailscale daemon local via Unix Domain Socket (RF-GW-08, RF-TS-05).
    /// Executa em sub-milissegundos (< 5ms) sobre o socket local.
    pub async fn query_whois(
        &self,
        client_ip: &str,
    ) -> Result<Option<WhoIsIdentity>, std::io::Error> {
        let clean_ip = client_ip.split(':').next().unwrap_or(client_ip);

        // 1. Checa cache local em memória (< 1ms)
        if let Some(cached) = self.cache.get(clean_ip) {
            debug!(
                ip = clean_ip,
                "WhoIs resolvido a partir do cache em memória"
            );
            return Ok(Some(cached));
        }

        // 2. Conecta ao Unix Domain Socket
        let mut stream = UnixStream::connect(&self.socket_path).await?;

        // 3. Monta requisição HTTP WhoIs
        let formatted_addr = if clean_ip.contains(':') {
            clean_ip.to_string()
        } else {
            format!("{}:0", clean_ip)
        };

        let request = format!(
            "GET /localapi/v0/whois?addr={} HTTP/1.1\r\nHost: local-tailscaled.sock\r\nConnection: close\r\n\r\n",
            formatted_addr
        );

        stream.write_all(request.as_bytes()).await?;

        // 4. Lê resposta
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await?;

        // 5. Separa headers do body HTTP
        let resp_str = String::from_utf8_lossy(&response);
        let parts: Vec<&str> = resp_str.splitn(2, "\r\n\r\n").collect();
        if parts.len() < 2 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Resposta HTTP incompleta recebida da LocalAPI do Tailscale",
            ));
        }

        let header_line = parts[0].lines().next().unwrap_or("");
        if header_line.contains(" 404 ") {
            return Ok(None);
        }

        if !header_line.contains(" 200 ") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("LocalAPI retornou status HTTP inesperado: {}", header_line),
            ));
        }

        let body = parts[1];
        let whois: TailscaleWhoIsResponse = serde_json::from_str(body).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Falha no parser JSON do WhoIs: {}", e),
            )
        })?;

        let node = whois.node.unwrap_or_default();
        let user = whois.user_profile.unwrap_or_default();

        let identity = WhoIsIdentity {
            user_id: user.id.to_string(),
            login_name: user.login_name,
            display_name: user.display_name,
            node_id: if !node.stable_id.is_empty() {
                node.stable_id
            } else {
                node.id.to_string()
            },
            tags: node.tags,
            client_ip: clean_ip.to_string(),
        };

        // Grava no cache com TTL
        self.cache.insert(clean_ip.to_string(), identity.clone());
        Ok(Some(identity))
    }

    /// Consulta WhoIs local com fallback automático para o Control Plane via gRPC IPC (RF-TS-14, RF-GW-08).
    pub async fn query_with_fallback(
        &self,
        client_ip: &str,
        ipc_client: Option<&mut GatewayIpcClient>,
    ) -> Option<WhoIsIdentity> {
        let clean_ip = client_ip.split(':').next().unwrap_or(client_ip);

        // 1. Tenta consulta local (ou cache)
        match self.query_whois(clean_ip).await {
            Ok(Some(id)) => return Some(id),
            Ok(None) => {}
            Err(e) => {
                warn!(
                    error = %e,
                    ip = clean_ip,
                    "Falha ao consultar LocalAPI WhoIs via Unix socket. Acionando fallback gRPC (RF-TS-14)..."
                );
            }
        }

        // 2. Se falhar ou socket não existir (ENOENT), aciona fallback IPC gRPC se disponível
        if let Some(client) = ipc_client {
            if let Ok(Some(resp)) = client.resolve_player_identity("", "", clean_ip).await {
                let id = WhoIsIdentity {
                    user_id: resp.user_id,
                    login_name: resp.minecraft_nick.clone(),
                    display_name: resp.minecraft_nick,
                    node_id: "".into(),
                    tags: resp.group_ids,
                    client_ip: clean_ip.to_string(),
                };
                self.cache.insert(clean_ip.to_string(), id.clone());
                return Some(id);
            }
        }

        None
    }
}

/// Verifica se o endereço IP pertence à rede CGNAT do Tailscale (100.64.0.0/10 ou ULA fd7a:115c:a1e0::/48) ou loopback (SEC-01).
pub fn is_tailscale_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            (octets[0] == 100 && (octets[1] & 0xC0) == 64) || v4.is_loopback()
        }
        std::net::IpAddr::V6(v6) => {
            let segs = v6.segments();
            (segs[0] == 0xfd7a && segs[1] == 0x115c && segs[2] == 0xa1e0) || v6.is_loopback()
        }
    }
}
