use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tracing::{error, info};

use gateway::ipc::run_control_plane_link;
use gateway::routing::RouteTable;
use gateway::session::SessionManager;
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

    // Com CONTROL_PLANE_GRPC_URL o Gateway sincroniza rotas e publica sessões; sem ela roda isolado.
    let control_plane_url = std::env::var("CONTROL_PLANE_GRPC_URL").ok().filter(|u| !u.is_empty());
    let route_table = RouteTable::new();
    let (session_tx, session_rx) = mpsc::unbounded_channel();
    let (wake_tx, wake_rx) = mpsc::unbounded_channel::<String>();

    // Sem consumidor os eventos só se acumulariam, então o emissor só existe com Control Plane.
    let mut session_manager = SessionManager::new();
    let mut server = GatewayServer::new(config).with_route_table(route_table.clone());
    if control_plane_url.is_some() {
        session_manager = session_manager.with_event_sender(session_tx.clone());
        server = server.with_wake_sender(wake_tx);
    }
    let server = server.with_session_manager(session_manager.clone());
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

    match control_plane_url {
        Some(url) => {
            info!("Integração com o Control Plane habilitada: {}", url);
            tokio::spawn(run_control_plane_link(
                url,
                route_table,
                session_manager,
                session_tx,
                session_rx,
                wake_rx,
                shutdown_rx.clone(),
            ));
        }
        None => info!("CONTROL_PLANE_GRPC_URL não definida: Gateway em modo isolado (sem sincronização de rotas)"),
    }

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
