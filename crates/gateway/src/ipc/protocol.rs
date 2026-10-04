use tracing::warn;

use crate::routing::{AccessPolicy, CachedServerRoute, RoutingModel, ServerInstanceStatus, UpstreamAddr};

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RouteUpdateEvent {
    #[prost(enumeration = "RouteAction", tag = "1")]
    pub action: i32,
    #[prost(string, tag = "2")]
    pub server_id: String,
    #[prost(string, tag = "3")]
    pub subdomain: String,
    #[prost(string, tag = "4")]
    pub target_ip_port: String,
    #[prost(string, tag = "5")]
    pub status: String,
    #[prost(string, tag = "6")]
    pub access_policy: String,
    #[prost(string, repeated, tag = "7")]
    pub allowed_group_ids: Vec<String>,
    #[prost(string, repeated, tag = "8")]
    pub allowed_user_ids: Vec<String>,
    #[prost(bool, tag = "9")]
    pub proxy_protocol: bool,
    #[prost(string, tag = "10")]
    pub game_type: String,
    #[prost(string, tag = "11")]
    pub routing_model: String,
    #[prost(int32, tag = "12")]
    pub listen_port: i32,
    #[prost(bool, tag = "13")]
    pub auto_wake: bool,
}

impl RouteUpdateEvent {
    /// `None` para destino vazio (servidor dormente) ou malformado; este último é logado porque
    /// deixa a rota sem upstream.
    pub fn parse_target(&self) -> Option<UpstreamAddr> {
        if self.target_ip_port.is_empty() {
            return None;
        }
        match self.target_ip_port.parse() {
            Ok(target) => Some(target),
            Err(reason) => {
                warn!(
                    server_id = %self.server_id,
                    target = %self.target_ip_port,
                    %reason,
                    "IPC: destino da rota inválido, rota ficará sem upstream"
                );
                None
            }
        }
    }

    pub fn to_cached_route(&self) -> CachedServerRoute {
        let target_addr = self.parse_target();

        CachedServerRoute {
            server_id: self.server_id.clone(),
            name: self.server_id.clone(),
            subdomain: self.subdomain.clone(),
            listener_port: self.listen_port as u16,
            routing_model: RoutingModel::from(self.routing_model.as_str()),
            target_addr,
            status: ServerInstanceStatus::from(self.status.as_str()),
            proxy_protocol_upstream: self.proxy_protocol,
            max_players: 20,
            protocol_version: 765,
            access_policy: AccessPolicy::from(self.access_policy.as_str()),
            allowed_group_ids: self.allowed_group_ids.clone(),
            allowed_user_ids: self.allowed_user_ids.clone(),
            game_type: self.game_type.clone(),
            auto_wake: self.auto_wake,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, ::prost::Enumeration)]
#[repr(i32)]
pub enum RouteAction {
    Upsert = 0,
    Delete = 1,
    StatusChange = 2,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SessionLifecycleEvent {
    #[prost(enumeration = "SessionEventType", tag = "1")]
    pub event_type: i32,
    #[prost(string, tag = "2")]
    pub session_id: String,
    #[prost(string, tag = "3")]
    pub server_id: String,
    #[prost(string, tag = "4")]
    pub client_ip: String,
    #[prost(string, tag = "5")]
    pub minecraft_nick: String,
    #[prost(int64, tag = "6")]
    pub timestamp_epoch_ms: i64,
    #[prost(string, tag = "7")]
    pub reason: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, ::prost::Enumeration)]
#[repr(i32)]
pub enum SessionEventType {
    Connected = 0,
    Disconnected = 1,
    WakeRequested = 2,
    AccessDenied = 3,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GatewayCommand {
    #[prost(string, tag = "1")]
    pub command_id: String,
    #[prost(message, optional, tag = "2")]
    pub revoke_session: Option<RevokeSessionRequest>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct GatewayCommandResult {
    #[prost(string, tag = "1")]
    pub command_id: String,
    #[prost(message, optional, tag = "2")]
    pub revoke_session: Option<RevokeSessionResponse>,
    #[prost(string, tag = "3")]
    pub error: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RevokeSessionRequest {
    #[prost(string, tag = "1")]
    pub server_id: String,
    #[prost(string, tag = "2")]
    pub client_ip: String,
    #[prost(string, tag = "3")]
    pub minecraft_nick: String,
    #[prost(string, tag = "4")]
    pub reason_message: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RevokeSessionResponse {
    #[prost(bool, tag = "1")]
    pub session_found: bool,
    #[prost(int32, tag = "2")]
    pub terminated_connections_count: i32,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RoutingSnapshotResponse {
    #[prost(message, repeated, tag = "1")]
    pub routes: Vec<RouteUpdateEvent>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ResolvePlayerRequest {
    #[prost(string, tag = "1")]
    pub tailscale_user_id: String,
    #[prost(string, tag = "2")]
    pub node_id: String,
    #[prost(string, tag = "3")]
    pub client_ip: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ResolvePlayerResponse {
    #[prost(bool, tag = "1")]
    pub found: bool,
    #[prost(string, tag = "2")]
    pub user_id: String,
    #[prost(string, tag = "3")]
    pub minecraft_nick: String,
    #[prost(string, tag = "4")]
    pub role: String,
    #[prost(string, repeated, tag = "5")]
    pub group_ids: Vec<String>,
    #[prost(bool, tag = "6")]
    pub is_active: bool,
    #[prost(bool, tag = "7")]
    pub is_mojang_verified: bool,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Empty {}
