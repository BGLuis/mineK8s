use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tracing::{debug, error, info};

use crate::config::GatewayConfig;
use crate::connection::{ClientConnection, HandshakeResult};
use crate::error::Result;
use crate::limiter::ConnectionRateLimiter;

pub struct GatewayServer {
    config: Arc<GatewayConfig>,
    rate_limiter: Arc<ConnectionRateLimiter>,
}

impl GatewayServer {
    pub fn new(config: GatewayConfig) -> Self {
        let rate_limit = config.rate_limit_per_second;
        Self {
            config: Arc::new(config),
            rate_limiter: Arc::new(ConnectionRateLimiter::new(rate_limit)),
        }
    }

    /// Executa o loop principal de aceitação de conexões TCP (RF-GW-01).
    pub async fn run(
        &self,
        listener: TcpListener,
        mut shutdown_rx: watch::Receiver<bool>,
    ) -> Result<()> {
        let local_addr = listener.local_addr()?;
        info!(addr = %local_addr, "Gateway L7 escutando conexões TCP");

        loop {
            tokio::select! {
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((stream, peer_addr)) => {
                            let config = Arc::clone(&self.config);
                            let rate_limiter = Arc::clone(&self.rate_limiter);

                            // RF-GW-01: Runtime Tokio multi-thread, uma task leve por conexão
                            tokio::spawn(async move {
                                if let Err(err) = Self::handle_connection(stream, peer_addr, config, rate_limiter).await {
                                    debug!(peer = %peer_addr, error = %err, "Conexão encerrada com erro");
                                }
                            });
                        }
                        Err(err) => {
                            error!(error = %err, "Falha ao aceitar conexão TCP");
                        }
                    }
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        info!("Sinal de shutdown recebido, finalizando listener TCP");
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_connection(
        stream: TcpStream,
        peer_addr: std::net::SocketAddr,
        config: Arc<GatewayConfig>,
        rate_limiter: Arc<ConnectionRateLimiter>,
    ) -> Result<()> {
        let mut conn = ClientConnection::new(stream, peer_addr);

        let handshake_res = conn
            .process_initial_handshake(&config, &rate_limiter)
            .await?;

        match handshake_res {
            HandshakeResult::Status { handshake, request: _, client_ip } => {
                debug!(
                    server = %handshake.server_address,
                    client_ip = %client_ip,
                    "Processado Handshake de Status com sucesso"
                );
                // Sub-issue #52 adicionará o MOTD dinâmico e resposta de Pong aqui
            }
            HandshakeResult::Login {
                handshake,
                login_start,
                client_ip,
                ..
            } => {
                info!(
                    user = %login_start.username,
                    server = %handshake.server_address,
                    client_ip = %client_ip,
                    "Processado Handshake de Login com sucesso"
                );
                // Sub-issue #53 conectará à JVM upstream e iniciará proxy duplex aqui
            }
        }

        Ok(())
    }
}
