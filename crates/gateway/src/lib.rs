pub mod config;
pub mod connection;
pub mod error;
pub mod identity;
pub mod ipc;
pub mod limiter;
pub mod motd;
pub mod routing;
pub mod server;
pub mod session;
pub mod telemetry;

pub use config::GatewayConfig;
pub use connection::{ClientConnection, HandshakeResult};
pub use error::{GatewayError, Result};
pub use identity::{
    is_tailscale_ip, is_valid_minecraft_nickname, validate_minecraft_nickname, AccessDecision,
    AccessDecisionEngine, IdentityLookup, IdentityResolver, NicknameDecision, PlayerIdentity,
    TailscaleLocalWhoIs, WhoIsCache, WhoIsIdentity,
};
pub use ipc::{GatewayIpcClient, RouteAction, RouteUpdateEvent};
pub use limiter::ConnectionRateLimiter;
pub use motd::{build_synthetic_status, handle_status_ping, StatusCache};
pub use routing::{
    AccessPolicy, CachedServerRoute, HoldError, RouteKey, RouteTable, RoutingModel,
    ServerInstanceStatus, UpstreamAddr,
};
pub use server::GatewayServer;
pub use session::{handle_login_proxy, ActiveSessionHandle, SessionManager};
pub use telemetry::{GatewayMetrics, TelemetryServer};
