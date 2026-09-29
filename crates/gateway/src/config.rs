use std::net::SocketAddr;
use std::time::Duration;
use minecraft_protocol::proxy_protocol::trusted::TrustedProxyFilter;

#[derive(Debug, Clone)]
pub struct GatewayConfig {
    pub listen_addr: SocketAddr,
    pub handshake_timeout: Duration,
    pub rate_limit_per_second: u32,
    pub trusted_proxies: TrustedProxyFilter,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            listen_addr: "0.0.0.0:25565".parse().unwrap(),
            handshake_timeout: Duration::from_secs(5),
            rate_limit_per_second: 10,
            trusted_proxies: std::env::var("TRUSTED_PROXY_IPS")
                .map(|csv| TrustedProxyFilter::from_csv(&csv))
                .unwrap_or_default(),
        }
    }
}
