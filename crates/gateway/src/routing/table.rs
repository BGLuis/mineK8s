use std::sync::{Arc, RwLock};
use std::time::Duration;
use dashmap::DashMap;
use tokio::sync::broadcast;

use crate::routing::route::{CachedServerRoute, RouteKey, RoutingModel, ServerInstanceStatus};

#[derive(Debug, PartialEq, Eq)]
pub enum HoldError {
    Timeout,
    Failed(ServerInstanceStatus),
    NotFound,
}

/// Tabela de rotas concorrente em memória gerenciada via DashMap com broadcast reativo (RF-GW-07, RF-GW-10).
#[derive(Clone)]
pub struct RouteTable {
    /// Mapeamento concorrente de RouteKey -> CachedServerRoute
    routes: Arc<DashMap<RouteKey, CachedServerRoute>>,
    /// Mapeamento de server_id -> RouteKey para rápida remoção ou atualização
    server_index: Arc<DashMap<String, RouteKey>>,
    /// Identificador do servidor padrão de fallback (Lobby/Default)
    default_server_id: Arc<RwLock<Option<String>>>,
    /// Canal de notificação reativa de mutações de status de rota (RF-GW-10)
    status_broadcaster: broadcast::Sender<(String, ServerInstanceStatus)>,
}

impl Default for RouteTable {
    fn default() -> Self {
        Self::new()
    }
}

impl RouteTable {
    pub fn new() -> Self {
        let (status_broadcaster, _) = broadcast::channel(256);
        Self {
            routes: Arc::new(DashMap::new()),
            server_index: Arc::new(DashMap::new()),
            default_server_id: Arc::new(RwLock::new(None)),
            status_broadcaster,
        }
    }

    /// Insere ou atualiza uma rota na tabela e notifica ouvintes do novo status (RF-GW-10).
    pub fn insert(&self, route: CachedServerRoute) {
        let key = match route.routing_model {
            RoutingModel::DedicatedPort => RouteKey::dedicated_port(route.listener_port),
            RoutingModel::VirtualHost => {
                RouteKey::virtual_host(route.listener_port, &route.subdomain)
            }
        };
        let server_id = route.server_id.clone();
        let status = route.status;
        self.server_index.insert(server_id.clone(), key.clone());
        self.routes.insert(key, route);
        let _ = self.status_broadcaster.send((server_id, status));
    }

    /// Remove uma rota associada ao server_id.
    pub fn remove(&self, server_id: &str) -> Option<CachedServerRoute> {
        if let Some((_, key)) = self.server_index.remove(server_id) {
            self.routes.remove(&key).map(|(_, route)| route)
        } else {
            None
        }
    }

    /// Define ou desativa o servidor padrão de fallback.
    pub fn set_default_server(&self, server_id: Option<String>) {
        let mut lock = self.default_server_id.write().unwrap();
        *lock = server_id;
    }

    /// Retorna o ID do servidor padrão de fallback se configurado.
    pub fn get_default_server_id(&self) -> Option<String> {
        self.default_server_id.read().unwrap().clone()
    }

    /// Busca de rota para listener de porta dedicada L4 (sem parser de protocolo).
    pub fn lookup_dedicated(&self, listener_port: u16) -> Option<CachedServerRoute> {
        let key = RouteKey::dedicated_port(listener_port);
        self.routes.get(&key).map(|r| r.value().clone())
    }

    /// Busca de rota para VirtualHost L7 por porta do listener e hostname.
    /// Se não encontrar a rota específica, recorre à busca por alvo SRV (RF-CF-05) ou servidor fallback padrão.
    pub fn lookup_virtual_host(&self, listener_port: u16, hostname: &str) -> Option<CachedServerRoute> {
        let normalized = hostname.to_ascii_lowercase();
        let key = RouteKey::virtual_host(listener_port, &normalized);
        if let Some(route) = self.routes.get(&key) {
            return Some(route.value().clone());
        }

        // RF-CF-05: Tentar buscar pelo prefixo de subdomínio do alvo SRV (ex: survival.minek8s.net -> survival)
        if let Some(prefix) = normalized.split('.').next() {
            if prefix != normalized {
                let prefix_key = RouteKey::virtual_host(listener_port, prefix);
                if let Some(route) = self.routes.get(&prefix_key) {
                    return Some(route.value().clone());
                }
            }
        }

        // Se o listener for público ou dedicado, busca entre todas as rotas VirtualHost registradas
        for item in self.routes.iter() {
            let r = item.value();
            if r.routing_model == RoutingModel::VirtualHost {
                if r.subdomain.eq_ignore_ascii_case(&normalized) {
                    return Some(r.clone());
                }
                if let Some(prefix) = normalized.split('.').next() {
                    if r.subdomain.eq_ignore_ascii_case(prefix) {
                        return Some(r.clone());
                    }
                }
            }
        }

        // Se não encontrar rota exata, tenta fallback default_server
        if let Some(default_id) = self.get_default_server_id() {
            if let Some(default_key) = self.server_index.get(&default_id) {
                if let Some(route) = self.routes.get(default_key.value()) {
                    return Some(route.value().clone());
                }
            }
        }

        None
    }

    /// Atualiza o status de um servidor existente e notifica os waiters reativamente.
    pub fn update_status(&self, server_id: &str, new_status: ServerInstanceStatus) -> bool {
        if let Some(key) = self.server_index.get(server_id) {
            if let Some(mut route) = self.routes.get_mut(key.value()) {
                route.status = new_status;
                let _ = self.status_broadcaster.send((server_id.to_string(), new_status));
                return true;
            }
        }
        false
    }

    /// Subscreve ao canal de broadcast de mutações de status.
    pub fn subscribe_status(&self) -> broadcast::Receiver<(String, ServerInstanceStatus)> {
        self.status_broadcaster.subscribe()
    }

    /// Aguarda reativamente até que o servidor com server_id atinja o estado Ready (RF-GW-10).
    /// Se a rota já estiver Ready, retorna imediatamente.
    /// Retorna Err(HoldError::Timeout) se o tempo limite expirar.
    pub async fn wait_for_ready(
        &self,
        server_id: &str,
        timeout_dur: Duration,
    ) -> Result<CachedServerRoute, HoldError> {
        // 1. Verificação imediata se a rota já está Ready
        if let Some(route) = self.get_by_server_id(server_id) {
            if route.status == ServerInstanceStatus::Ready {
                return Ok(route);
            }
            if route.status == ServerInstanceStatus::Crashed || route.status == ServerInstanceStatus::Failed {
                return Err(HoldError::Failed(route.status));
            }
        } else {
            return Err(HoldError::NotFound);
        }

        // 2. Subscrição reativa para aguardar mutação de status
        let mut rx = self.subscribe_status();
        let deadline = tokio::time::Instant::now() + timeout_dur;

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(HoldError::Timeout);
            }

            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Ok((id, status))) => {
                    if id == server_id {
                        if status == ServerInstanceStatus::Ready {
                            if let Some(ready_route) = self.get_by_server_id(server_id) {
                                return Ok(ready_route);
                            }
                        } else if status == ServerInstanceStatus::Crashed || status == ServerInstanceStatus::Failed {
                            return Err(HoldError::Failed(status));
                        }
                    }
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => {
                    // Em caso de lag no canal, valida o estado atual direto na tabela
                    if let Some(route) = self.get_by_server_id(server_id) {
                        if route.status == ServerInstanceStatus::Ready {
                            return Ok(route);
                        }
                    }
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    return Err(HoldError::NotFound);
                }
                Err(_) => {
                    return Err(HoldError::Timeout);
                }
            }
        }
    }

    /// Reconstrói a tabela de rotas inteira a partir de um snapshot recebido via IPC (RF-GW-16).
    pub fn rebuild_from_snapshot(&self, routes: Vec<CachedServerRoute>) {
        self.routes.clear();
        self.server_index.clear();
        for route in routes {
            self.insert(route);
        }
    }

    /// Retorna todas as rotas atualmente carregadas na tabela.
    pub fn all_routes(&self) -> Vec<CachedServerRoute> {
        self.routes.iter().map(|entry| entry.value().clone()).collect()
    }

    /// Retorna a rota associada ao server_id se existir.
    pub fn get_by_server_id(&self, server_id: &str) -> Option<CachedServerRoute> {
        if let Some(key) = self.server_index.get(server_id) {
            self.routes.get(key.value()).map(|r| r.value().clone())
        } else {
            None
        }
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }
}
