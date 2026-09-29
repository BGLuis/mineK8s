use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tracing::{error, info};

use gateway::telemetry::TelemetryServer;
use gateway::{GatewayConfig, GatewayServer};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gateway=info,minecraft_protocol=info".into()),
        )
        .init();

    let listen_addr: SocketAddr = std::env::var("GATEWAY_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:25565".into())
        .parse()?;

    let metrics_addr: SocketAddr = std::env::var("METRICS_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:9090".into())
        .parse()?;

    let mut config = GatewayConfig::default();
    config.listen_addr = listen_addr;
    let public_listen_addr = config.public_listen_addr;

    let server = GatewayServer::new(config);
    let metrics = Arc::clone(server.metrics());
    let listener = TcpListener::bind(listen_addr).await?;
    info!("Iniciando MineKubernetes Gateway L7 em {}", listen_addr);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Servidor de Telemetria Prometheus e Healthz na porta 9090 (RF-GW-17)
    let metrics_listener = TcpListener::bind(metrics_addr).await?;
    let telemetry_server = TelemetryServer::new(metrics);
    let telemetry_shutdown_rx = shutdown_rx.clone();

    tokio::spawn(async move {
        info!("Iniciando servidor de telemetria em {}", metrics_addr);
        if let Err(err) = telemetry_server.run(metrics_listener, telemetry_shutdown_rx).await {
            error!("Erro no servidor de telemetria: {}", err);
        }
    });

    let shutdown_signal_tx = shutdown_tx.clone();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("Sinal de interrupção (Ctrl+C) recebido");
            let _ = shutdown_signal_tx.send(true);
        }
    });

    let public_listener = match public_listen_addr {
        Some(addr) => {
            info!("Iniciando listener público em {}", addr);
            Some(TcpListener::bind(addr).await?)
        }
        None => None,
    };

    if let Err(err) = server.run_dual(listener, public_listener, shutdown_rx).await {
        error!("Erro fatal no GatewayServer: {}", err);
    }

    Ok(())
}
