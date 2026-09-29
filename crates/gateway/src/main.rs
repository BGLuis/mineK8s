use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tracing::{error, info};

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

    let mut config = GatewayConfig::default();
    config.listen_addr = listen_addr;

    let server = GatewayServer::new(config);
    let listener = TcpListener::bind(listen_addr).await?;
    info!("Iniciando MineKubernetes Gateway L7 em {}", listen_addr);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("Sinal de interrupção (Ctrl+C) recebido");
            let _ = shutdown_tx.send(true);
        }
    });

    if let Err(err) = server.run(listener, shutdown_rx).await {
        error!("Erro fatal no GatewayServer: {}", err);
    }

    Ok(())
}
