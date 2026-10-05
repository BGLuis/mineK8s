use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct CachedStatusEntry {
    pub json: String,
    pub cached_at: Instant,
}

/// Cache concorrente com TTL de 3.0 segundos para status de instâncias online (RF-GW-09).
#[derive(Clone)]
pub struct StatusCache {
    entries: Arc<DashMap<String, CachedStatusEntry>>,
    ttl: Duration,
}

impl Default for StatusCache {
    fn default() -> Self {
        Self::new(Duration::from_secs(3))
    }
}

impl StatusCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            entries: Arc::new(DashMap::new()),
            ttl,
        }
    }

    /// Retorna a resposta JSON em cache caso ainda esteja válida dentro do TTL.
    pub fn get(&self, server_id: &str) -> Option<String> {
        if let Some(entry) = self.entries.get(server_id) {
            if entry.cached_at.elapsed() < self.ttl {
                return Some(entry.json.clone());
            }
        }
        None
    }

    /// Insere ou substitui o payload JSON de status com timestamp atual.
    pub fn set(&self, server_id: impl Into<String>, json: String) {
        self.entries.insert(
            server_id.into(),
            CachedStatusEntry {
                json,
                cached_at: Instant::now(),
            },
        );
    }

    pub fn clear(&self) {
        self.entries.clear();
    }
}
