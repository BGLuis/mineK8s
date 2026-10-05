use std::fmt;
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::error::{GatewayError, Result};

/// Cobre resolução de nome e conexão: sem limite, um DNS que não responde seguraria o login do jogador.
pub const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Destino de uma rota: IP literal ou hostname (`mc-x.ns.svc.cluster.local`) com porta.
///
/// O nome nunca é resolvido ao receber a rota. Cada conexão resolve de novo, porque o IP do pod
/// muda a cada reinício e a rota em cache continua apontando para o mesmo nome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpstreamAddr {
    host: String,
    port: u16,
}

impl UpstreamAddr {
    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn connect(&self) -> Result<TcpStream> {
        self.connect_with(resolve_system).await
    }

    /// `resolve` é injetável para testar a troca de IP entre conexões sem depender do DNS do host.
    pub async fn connect_with<R, Fut>(&self, resolve: R) -> Result<TcpStream>
    where
        R: Fn(String, u16) -> Fut,
        Fut: Future<Output = io::Result<Vec<SocketAddr>>>,
    {
        let attempt = async {
            let addrs = resolve(self.host.clone(), self.port)
                .await
                .map_err(|source| GatewayError::UpstreamResolution {
                    host: self.host.clone(),
                    source,
                })?;

            let mut last_error = None;
            for addr in addrs {
                match TcpStream::connect(addr).await {
                    Ok(stream) => return Ok(stream),
                    Err(err) => last_error = Some(err),
                }
            }
            Err(match last_error {
                Some(err) => GatewayError::Io(err),
                None => GatewayError::UpstreamResolution {
                    host: self.host.clone(),
                    source: io::Error::new(io::ErrorKind::NotFound, "nenhum endereço devolvido"),
                },
            })
        };

        match timeout(UPSTREAM_CONNECT_TIMEOUT, attempt).await {
            Ok(result) => result,
            Err(_) => Err(GatewayError::Io(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("timeout ao conectar em {self}"),
            ))),
        }
    }
}

async fn resolve_system(host: String, port: u16) -> io::Result<Vec<SocketAddr>> {
    tokio::net::lookup_host((host.as_str(), port))
        .await
        .map(Iterator::collect)
}

impl From<SocketAddr> for UpstreamAddr {
    fn from(addr: SocketAddr) -> Self {
        Self {
            host: addr.ip().to_string(),
            port: addr.port(),
        }
    }
}

impl FromStr for UpstreamAddr {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        if let Ok(addr) = s.parse::<SocketAddr>() {
            return Ok(addr.into());
        }
        let (host, port) = s
            .rsplit_once(':')
            .ok_or_else(|| format!("destino '{s}' não está no formato host:porta"))?;
        if host.is_empty() || host.contains(':') {
            return Err(format!("host inválido em '{s}'"));
        }
        let port = port
            .parse::<u16>()
            .map_err(|_| format!("porta inválida em '{s}'"))?;
        Ok(Self {
            host: host.to_string(),
            port,
        })
    }
}

impl fmt::Display for UpstreamAddr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.host.contains(':') {
            write!(f, "[{}]:{}", self.host, self.port)
        } else {
            write!(f, "{}:{}", self.host, self.port)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;

    #[test]
    fn parses_ip_literal_and_hostname() {
        let ip: UpstreamAddr = "10.0.1.10:25565".parse().unwrap();
        assert_eq!(ip, SocketAddr::from(([10, 0, 1, 10], 25565)).into());

        let v6: UpstreamAddr = "[::1]:25565".parse().unwrap();
        assert_eq!(v6.to_string(), "[::1]:25565");

        let name: UpstreamAddr = "mc-survival.minekubernetes.svc.cluster.local:25565"
            .parse()
            .unwrap();
        assert_eq!(name.host(), "mc-survival.minekubernetes.svc.cluster.local");
        assert_eq!(name.port(), 25565);
        assert_eq!(
            name.to_string(),
            "mc-survival.minekubernetes.svc.cluster.local:25565"
        );
    }

    #[test]
    fn rejects_malformed_targets() {
        for bad in [
            "",
            "mc-survival",
            ":25565",
            "host:",
            "host:99999",
            "a:b:25565",
        ] {
            assert!(
                bad.parse::<UpstreamAddr>().is_err(),
                "'{bad}' deveria ser rejeitado"
            );
        }
    }

    #[tokio::test]
    async fn resolves_hostname_on_every_connection() {
        let first_pod = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let second_pod = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let pod_ips = [
            first_pod.local_addr().unwrap(),
            second_pod.local_addr().unwrap(),
        ];

        let lookups = AtomicUsize::new(0);
        let resolver = |_host: String, _port: u16| {
            let current = pod_ips[lookups.fetch_add(1, Ordering::SeqCst).min(1)];
            async move { Ok(vec![current]) }
        };

        let target: UpstreamAddr = "mc-survival.minekubernetes.svc.cluster.local:25565"
            .parse()
            .unwrap();

        let before_restart = target.connect_with(&resolver).await.unwrap();
        assert_eq!(before_restart.peer_addr().unwrap(), pod_ips[0]);

        let after_restart = target.connect_with(&resolver).await.unwrap();
        assert_eq!(after_restart.peer_addr().unwrap(), pod_ips[1]);
        assert_eq!(lookups.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn falls_through_to_next_resolved_address() {
        let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dead_addr = dead.local_addr().unwrap();
        drop(dead);
        let alive = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let alive_addr = alive.local_addr().unwrap();

        let target: UpstreamAddr = "mc-survival:25565".parse().unwrap();
        let stream = target
            .connect_with(|_, _| async move { Ok(vec![dead_addr, alive_addr]) })
            .await
            .unwrap();
        assert_eq!(stream.peer_addr().unwrap(), alive_addr);
    }

    #[tokio::test]
    async fn unresolvable_host_is_reported_as_resolution_error() {
        let target: UpstreamAddr = "mc-gone.minekubernetes.svc.cluster.local:25565"
            .parse()
            .unwrap();

        let failed = target
            .connect_with(|_, _| async { Err(io::Error::new(io::ErrorKind::NotFound, "NXDOMAIN")) })
            .await;
        assert!(matches!(
            failed,
            Err(GatewayError::UpstreamResolution { .. })
        ));

        let empty = target.connect_with(|_, _| async { Ok(Vec::new()) }).await;
        assert!(matches!(
            empty,
            Err(GatewayError::UpstreamResolution { .. })
        ));
    }

    #[tokio::test]
    async fn refused_connection_is_not_reported_as_resolution_error() {
        let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dead_addr = dead.local_addr().unwrap();
        drop(dead);

        let failed = UpstreamAddr::from(dead_addr).connect().await;
        assert!(matches!(failed, Err(GatewayError::Io(_))));
    }
}
