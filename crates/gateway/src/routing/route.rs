use std::net::SocketAddr;
use serde::{Deserialize, Serialize};

/// Modelo de roteamento suportado pelo Gateway (RF-MG-03, Inventário §2.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoutingModel {
    /// Roteamento L7 baseado em VirtualHost / Hostname do Minecraft (Handshake 0x00)
    VirtualHost,
    /// Encaminhamento L4 direto sem parser de protocolo (porta dedicada para Terraria ou bypass)
    DedicatedPort,
}

/// Estado do ciclo de vida da instância de servidor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServerInstanceStatus {
    Stopped,
    Starting,
    Ready,
    Maintenance,
    Crashed,
}

/// Chave composta para indexação na RouteTable.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RouteKey {
    pub listener_port: u16,
    pub hostname: Option<String>,
}

impl RouteKey {
    pub fn virtual_host(listener_port: u16, hostname: impl Into<String>) -> Self {
        Self {
            listener_port,
            hostname: Some(hostname.into().to_ascii_lowercase()),
        }
    }

    pub fn dedicated_port(listener_port: u16) -> Self {
        Self {
            listener_port,
            hostname: None,
        }
    }
}

/// Representa uma rota em cache mantida em memória pelo Gateway L7.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedServerRoute {
    pub server_id: String,
    pub name: String,
    pub subdomain: String,
    pub listener_port: u16,
    pub routing_model: RoutingModel,
    pub target_addr: Option<SocketAddr>,
    pub status: ServerInstanceStatus,
    pub proxy_protocol_upstream: bool,
    pub max_players: u32,
    pub protocol_version: i32,
}
