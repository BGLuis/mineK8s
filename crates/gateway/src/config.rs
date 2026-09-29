use std::net::SocketAddr;
use std::time::Duration;
use minecraft_protocol::proxy_protocol::trusted::TrustedProxyFilter;

#[derive(Debug, Clone)]
pub struct GatewayConfig {
    pub listen_addr: SocketAddr,
    pub public_listen_addr: Option<SocketAddr>,
    pub handshake_timeout: Duration,
    pub rate_limit_per_second: u32,
    pub public_rate_limit_per_second: u32,
    pub trusted_proxies: TrustedProxyFilter,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        let public_listen_addr = std::env::var("GATEWAY_PUBLIC_ADDR")
            .ok()
            .and_then(|a| a.parse().ok())
            .or_else(|| {
                std::env::var("GATEWAY_PUBLIC_PORT")
                    .ok()
                    .and_then(|p| format!("0.0.0.0:{}", p).parse().ok())
            });

        Self {
            listen_addr: std::env::var("GATEWAY_LISTEN_ADDR")
                .ok()
                .and_then(|a| a.parse().ok())
                .unwrap_or_else(|| "0.0.0.0:25565".parse().unwrap()),
            public_listen_addr,
            handshake_timeout: Duration::from_secs(5),
            rate_limit_per_second: 10,
            public_rate_limit_per_second: std::env::var("GATEWAY_PUBLIC_RATE_LIMIT")
                .ok()
                .and_then(|r| r.parse().ok())
                .unwrap_or(20),
            trusted_proxies: std::env::var("TRUSTED_PROXY_IPS")
                .map(|csv| TrustedProxyFilter::from_csv(&csv))
                .unwrap_or_default(),
        }
    }
}
