use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tracing::{debug, error, info};

use crate::telemetry::metrics::GatewayMetrics;

/// Servidor HTTP leve para telemetria Prometheus e health checks (RF-GW-17, GW:523-552).
pub struct TelemetryServer {
    metrics: Arc<GatewayMetrics>,
}

impl TelemetryServer {
    pub fn new(metrics: Arc<GatewayMetrics>) -> Self {
        Self { metrics }
    }

    /// Executa o loop de aceitação HTTP para requisições de raspagem e health check na porta 9090.
    pub async fn run(
        &self,
        listener: TcpListener,
        mut shutdown_rx: watch::Receiver<bool>,
    ) -> std::io::Result<()> {
        let local_addr = listener.local_addr()?;
        info!(addr = %local_addr, "Servidor de telemetria HTTP escutando");

        loop {
            tokio::select! {
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((stream, _peer_addr)) => {
                            let metrics = Arc::clone(&self.metrics);
                            tokio::spawn(async move {
                                if let Err(err) = Self::handle_http(stream, metrics).await {
                                    debug!(error = %err, "Erro na requisição HTTP de telemetria");
                                }
                            });
                        }
                        Err(err) => {
                            error!(error = %err, "Falha ao aceitar conexão HTTP de telemetria");
                        }
                    }
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        info!("Shutdown recebido no servidor de telemetria");
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_http(mut stream: TcpStream, metrics: Arc<GatewayMetrics>) -> std::io::Result<()> {
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }

        let request = String::from_utf8_lossy(&buf[..n]);
        let first_line = request.lines().next().unwrap_or("");

        if first_line.starts_with("GET /metrics") {
            let body = metrics.encode_text();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await?;
        } else if first_line.starts_with("GET /healthz") {
            let body = "OK\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).await?;
        } else {
            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await?;
        }

        let _ = stream.shutdown().await;
        Ok(())
    }
}
