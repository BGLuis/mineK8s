use std::net::SocketAddr;
use serde::{Deserialize, Serialize};

/// Política de acesso ao servidor (RF-ID-02, RF-ID-06, RF-CF-01).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AccessPolicy {
    #[default]
    Public,
    Group,
    Individual,
    Maintenance,
    Internet,
}

impl From<&str> for AccessPolicy {
    fn from(s: &str) -> Self {
        match s.to_ascii_uppercase().as_str() {
            "GROUP" => AccessPolicy::Group,
            "INDIVIDUAL" => AccessPolicy::Individual,
            "MAINTENANCE" => AccessPolicy::Maintenance,
            "INTERNET" => AccessPolicy::Internet,
            _ => AccessPolicy::Public,
        }
    }
}

/// Modelo de roteamento suportado pelo Gateway (RF-MG-03, Inventário §2.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RoutingModel {
    /// Roteamento L7 baseado em VirtualHost / Hostname do Minecraft (Handshake 0x00)
    #[default]
    VirtualHost,
    /// Encaminhamento L4 direto sem parser de protocolo (porta dedicada para Terraria ou bypass)
    DedicatedPort,
}

impl From<&str> for RoutingModel {
    fn from(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "dedicatedport" | "dedicated_port" => RoutingModel::DedicatedPort,
            _ => RoutingModel::VirtualHost,
        }
    }
}

/// Estado do ciclo de vida da instância de servidor (Resolução C-01 / RF-ARQ-01).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ServerInstanceStatus {
    Provisioning,
    Starting,
    #[default]
    Ready,
    Stopping,
    Stopped,
    Updating,
    Crashed,
    Failed,
}

impl From<&str> for ServerInstanceStatus {
    fn from(s: &str) -> Self {
        match s.to_ascii_uppercase().as_str() {
            "PROVISIONING" => ServerInstanceStatus::Provisioning,
            "STARTING" => ServerInstanceStatus::Starting,
            "STOPPING" => ServerInstanceStatus::Stopping,
            "STOPPED" => ServerInstanceStatus::Stopped,
            "UPDATING" => ServerInstanceStatus::Updating,
            "CRASHED" => ServerInstanceStatus::Crashed,
            "FAILED" => ServerInstanceStatus::Failed,
            _ => ServerInstanceStatus::Ready,
        }
    }
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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub access_policy: AccessPolicy,
    pub allowed_group_ids: Vec<String>,
    pub allowed_user_ids: Vec<String>,
    pub game_type: String,
    pub auto_wake: bool,
}

