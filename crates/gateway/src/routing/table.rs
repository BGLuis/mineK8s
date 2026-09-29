use std::sync::{Arc, RwLock};
use dashmap::DashMap;

use crate::routing::route::{CachedServerRoute, RouteKey, RoutingModel};

/// Tabela de rotas concorrente em memória gerenciada via DashMap (RF-GW-07, RF-MG-03).
#[derive(Clone, Default)]
pub struct RouteTable {
    /// Mapeamento concorrente de RouteKey -> CachedServerRoute
    routes: Arc<DashMap<RouteKey, CachedServerRoute>>,
    /// Mapeamento de server_id -> RouteKey para rápida remoção ou atualização
    server_index: Arc<DashMap<String, RouteKey>>,
    /// Identificador do servidor padrão de fallback (Lobby/Default)
    default_server_id: Arc<RwLock<Option<String>>>,
}

impl RouteTable {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insere ou atualiza uma rota na tabela.
    pub fn insert(&self, route: CachedServerRoute) {
        let key = match route.routing_model {
            RoutingModel::DedicatedPort => RouteKey::dedicated_port(route.listener_port),
            RoutingModel::VirtualHost => {
                RouteKey::virtual_host(route.listener_port, &route.subdomain)
            }
        };
        self.server_index.insert(route.server_id.clone(), key.clone());
        self.routes.insert(key, route);
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
    /// Se não encontrar a rota específica, recorre ao servidor fallback padrão.
    pub fn lookup_virtual_host(&self, listener_port: u16, hostname: &str) -> Option<CachedServerRoute> {
        let normalized = hostname.to_ascii_lowercase();
        let key = RouteKey::virtual_host(listener_port, normalized);
        if let Some(route) = self.routes.get(&key) {
            return Some(route.value().clone());
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

