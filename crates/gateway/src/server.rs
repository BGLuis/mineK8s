use std::sync::Arc;
use std::time::Instant;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tracing::{debug, error, info, warn};

use crate::config::GatewayConfig;
use crate::connection::{ClientConnection, HandshakeResult};
use crate::error::{GatewayError, Result};
use crate::identity::{
    validate_minecraft_nickname, AccessDecision, AccessDecisionEngine, NicknameDecision,
    TailscaleLocalWhoIs,
};
use std::time::Duration;
use tokio::sync::mpsc;
use minecraft_protocol::error::ProtocolError;
use crate::limiter::ConnectionRateLimiter;
use crate::motd::{handle_status_ping, StatusCache};
use crate::routing::{HoldError, RouteTable, RoutingModel, ServerInstanceStatus};
use crate::session::{handle_login_proxy, SessionManager};
use crate::telemetry::GatewayMetrics;

pub struct GatewayServer {
    config: Arc<GatewayConfig>,
    rate_limiter: Arc<ConnectionRateLimiter>,
    route_table: RouteTable,
    status_cache: StatusCache,
    session_manager: SessionManager,
    metrics: Arc<GatewayMetrics>,
    whois: Option<TailscaleLocalWhoIs>,
    wake_sender: Option<mpsc::UnboundedSender<String>>,
}

impl GatewayServer {
    pub fn new(config: GatewayConfig) -> Self {
        let rate_limit = config.rate_limit_per_second;
        Self {
            config: Arc::new(config),
            rate_limiter: Arc::new(ConnectionRateLimiter::new(rate_limit)),
            route_table: RouteTable::new(),
            status_cache: StatusCache::default(),
            session_manager: SessionManager::default(),
            metrics: Arc::new(GatewayMetrics::new()),
            whois: None,
            wake_sender: None,
        }
    }

    pub fn with_whois(mut self, whois: TailscaleLocalWhoIs) -> Self {
        self.whois = Some(whois);
        self
    }

    pub fn with_wake_sender(mut self, wake_sender: mpsc::UnboundedSender<String>) -> Self {
        self.wake_sender = Some(wake_sender);
        self
    }

    pub fn with_route_table(mut self, route_table: RouteTable) -> Self {
        self.route_table = route_table;
        self
    }

    pub fn with_status_cache(mut self, status_cache: StatusCache) -> Self {
        self.status_cache = status_cache;
        self
    }

    pub fn with_session_manager(mut self, session_manager: SessionManager) -> Self {
        self.session_manager = session_manager;
        self
    }

    pub fn with_metrics(mut self, metrics: Arc<GatewayMetrics>) -> Self {
        self.metrics = metrics;
        self
    }

    pub fn route_table(&self) -> &RouteTable {
        &self.route_table
    }

    pub fn status_cache(&self) -> &StatusCache {
        &self.status_cache
    }

    pub fn session_manager(&self) -> &SessionManager {
        &self.session_manager
    }

    pub fn metrics(&self) -> &Arc<GatewayMetrics> {
        &self.metrics
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
                            let route_table = self.route_table.clone();
                            let status_cache = self.status_cache.clone();
                            let session_manager = self.session_manager.clone();
                            let metrics = Arc::clone(&self.metrics);
                            let whois = self.whois.clone();
                            let wake_sender = self.wake_sender.clone();

                            // RF-GW-01: Runtime Tokio multi-thread, uma task leve por conexão
                            tokio::spawn(async move {
                                if let Err(err) = Self::handle_connection(
                                    stream,
                                    peer_addr,
                                    config,
                                    rate_limiter,
                                    route_table,
                                    status_cache,
                                    session_manager,
                                    metrics,
                                    whois,
                                    wake_sender,
                                ).await {
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
        mut stream: TcpStream,
        peer_addr: std::net::SocketAddr,
        config: Arc<GatewayConfig>,
        rate_limiter: Arc<ConnectionRateLimiter>,
        route_table: RouteTable,
        status_cache: StatusCache,
        session_manager: SessionManager,
        metrics: Arc<GatewayMetrics>,
        whois: Option<TailscaleLocalWhoIs>,
        wake_sender: Option<mpsc::UnboundedSender<String>>,
    ) -> Result<()> {
        let start_time = Instant::now();

        // 1. Rate limiting pré-roteamento
        if !rate_limiter.check(peer_addr.ip()) {
            metrics
                .connections_total
                .with_label_values(&["unknown", "rate_limited"])
                .inc();
            return Err(GatewayError::RateLimited(peer_addr.ip()));
        }

        let local_port = stream.local_addr().map(|a| a.port()).unwrap_or(0);

        // 2. RF-MG-03 / Critério de aceite: Rota dedicated-port faz forward L4 direto SEM invocar o parser
        if let Some(dedicated_route) = route_table.lookup_dedicated(local_port) {
            if dedicated_route.routing_model == RoutingModel::DedicatedPort {
                if let Some(target_addr) = dedicated_route.target_addr {
                    metrics
                        .connections_total
                        .with_label_values(&["dedicated-port", "accepted"])
                        .inc();
                    debug!(
                        server = %dedicated_route.name,
                        target = %target_addr,
                        "Iniciando forward L4 dedicado direto (sem parser)"
                    );
                    let mut upstream = TcpStream::connect(target_addr).await?;
                    let _ = copy_bidirectional(&mut stream, &mut upstream).await;
                    return Ok(());
                } else {
                    return Err(GatewayError::InvalidState(format!(
                        "Rota dedicada {} não possui target_addr configurado",
                        dedicated_route.server_id
                    )));
                }
            }
        }

        // 3. Rota padrão VirtualHost: Processa Handshake streaming do Minecraft L7
        let mut conn = ClientConnection::new(stream, peer_addr);
        let handshake_res = match conn
            .process_initial_handshake(&config, &rate_limiter)
            .await
        {
            Ok(res) => res,
            Err(GatewayError::Protocol(ProtocolError::InvalidUsername(ref username))) => {
                warn!(
                    user = %username,
                    peer = %peer_addr,
                    "Login rejeitado por formato de nickname inválido (< 50ms)"
                );
                let msg = match validate_minecraft_nickname(username) {
                    Err(err) => err.message().to_string(),
                    Ok(_) => "§cFormato de nickname inválido.".to_string(),
                };
                return Self::send_login_disconnect(conn, &msg).await;
            }
            Err(GatewayError::Protocol(ProtocolError::StringTooLong { .. })) => {
                warn!(
                    peer = %peer_addr,
                    "Login rejeitado por tamanho de string excedido (< 50ms)"
                );
                return Self::send_login_disconnect(conn, "§cNickname deve ter no máximo 16 caracteres.").await;
            }
            Err(e) => return Err(e),
        };

        // Métricas de latência do handshake
        let handshake_duration = start_time.elapsed().as_secs_f64();
        metrics
            .handshake_duration_seconds
            .observe(handshake_duration);

        match handshake_res {
            HandshakeResult::Status { handshake, request: _, client_ip } => {
                metrics
                    .connections_total
                    .with_label_values(&[&handshake.server_address, "accepted"])
                    .inc();

                let route = route_table.lookup_virtual_host(local_port, &handshake.server_address);
                debug!(
                    server = %handshake.server_address,
                    route = ?route.as_ref().map(|r| &r.server_id),
                    client_ip = %client_ip,
                    "Processando Server List Ping"
                );
                // RF-GW-09: Processa Server List Ping com MOTD sintético dinâmico e cache TTL de 3s
                handle_status_ping(conn, route, &status_cache).await?;
            }
            HandshakeResult::Login {
                handshake,
                login_start,
                original_handshake,
                original_login_start,
                client_ip,
            } => {
                // 1. Validação estrita do formato de nickname (RF-ARQ-21, GW:430-432)
                if let Err(err) = validate_minecraft_nickname(&login_start.username) {
                    warn!(
                        user = %login_start.username,
                        error = ?err,
                        peer = %peer_addr,
                        "Login rejeitado por formato de nickname inválido (< 50ms)"
                    );
                    return Self::send_login_disconnect(conn, err.message()).await;
                }

                // 2. Busca e validação de rota
                let route = route_table.lookup_virtual_host(local_port, &handshake.server_address);
                let route = match route {
                    Some(r) => r,
                    None => {
                        warn!(
                            host = %handshake.server_address,
                            peer = %peer_addr,
                            "Servidor de destino não encontrado na tabela de rotas"
                        );
                        return Self::send_login_disconnect(conn, "§cServidor não encontrado.").await;
                    }
                };

                // 3. Validação de WhoIs, Anti-Impersonation e Avaliação de Acesso Zero-Trust (RF-TS-02, RF-ARQ-21)
                if let Some(whois_driver) = &whois {
                    if let Ok(Some(whois_id)) = whois_driver.query_whois(&client_ip.to_string()).await {
                        let registered_nick = if !whois_id.display_name.is_empty() {
                            &whois_id.display_name
                        } else {
                            &whois_id.login_name
                        };

                        // Validação de Anti-Impersonation (< 50ms)
                        match AccessDecisionEngine::evaluate_nickname(&login_start.username, registered_nick) {
                            NicknameDecision::Impersonation { registered_nick } => {
                                warn!(
                                    declared = %login_start.username,
                                    registered = %registered_nick,
                                    peer = %peer_addr,
                                    "Tentativa de impersonação rejeitada (< 50ms)"
                                );
                                return Self::send_login_disconnect(
                                    conn,
                                    "§cEste nickname não pertence a este dispositivo/conta.",
                                ).await;
                            }
                            NicknameDecision::Invalid(err) => {
                                return Self::send_login_disconnect(conn, err.message()).await;
                            }
                            NicknameDecision::Match | NicknameDecision::AutoAdopt => {}
                        }

                        // Avaliação de Política de Acesso (PUBLIC, GROUP, INDIVIDUAL, MAINTENANCE, ADMIN bypass)
                        let is_admin = whois_id.tags.iter().any(|t| t == "tag:mc-gateway" || t == "autogroup:admin");
                        let user_role = if is_admin { "ADMIN" } else { "PLAYER" };
                        let decision = AccessDecisionEngine::evaluate_access(
                            &whois_id.user_id,
                            user_role,
                            &whois_id.tags,
                            true,
                            &route,
                        );

                        if let AccessDecision::Denied { reason } = decision {
                            warn!(
                                user = %login_start.username,
                                server = %route.name,
                                reason = %reason,
                                "Acesso negado pela política do servidor"
                            );
                            return Self::send_login_disconnect(conn, reason).await;
                        }
                    }
                }

                // RF-GW-10: Tratamento de Auto-Wake e Retenção de Conexão (Hold Connection até 25s)
                let active_route = if route.status != ServerInstanceStatus::Ready {
                    if route.status == ServerInstanceStatus::Stopped {
                        if !route.auto_wake {
                            warn!(
                                server = %route.name,
                                "Login rejeitado: servidor parado e auto-wake desativado"
                            );
                            return Self::send_login_disconnect(conn, "§cServidor desligado e Auto-Wake desativado.").await;
                        }

                        info!(
                            server = %route.name,
                            "Servidor em hibernação (STOPPED). Disparando TriggerServerWake (RF-GW-10)..."
                        );
                        if let Some(ref tx) = wake_sender {
                            let _ = tx.send(route.server_id.clone());
                        }
                    } else if route.status == ServerInstanceStatus::Crashed || route.status == ServerInstanceStatus::Failed {
                        warn!(
                            server = %route.name,
                            status = ?route.status,
                            "Login rejeitado: servidor em estado de falha terminal"
                        );
                        return Self::send_login_disconnect(conn, "§cServidor indisponível (estado de falha).").await;
                    }

                    info!(
                        server = %route.name,
                        status = ?route.status,
                        "Iniciando retenção de conexão (Hold Connection até 25s, RF-GW-10)"
                    );

                    match route_table.wait_for_ready(&route.server_id, Duration::from_secs(25)).await {
                        Ok(ready_route) => {
                            info!(
                                server = %ready_route.name,
                                "Servidor atingiu READY dentro da janela de retenção! Prosseguindo com conexão."
                            );
                            ready_route
                        }
                        Err(HoldError::Timeout) => {
                            warn!(
                                server = %route.name,
                                "Timeout de 25s de hold connection expirado. Enviando mensagem de boot em segundo plano."
                            );
                            let friendly_msg = r#"{"text":"🚀 §e§lMineKubernetes — Servidor em Inicialização!\n\n§fEste servidor estava hibernando para economizar recursos e §afoi acordado agora§f.\n§7A inicialização continua sendo processada em segundo plano no cluster.\n\n§6Por favor, aguarde cerca de 30 a 60 segundos e tente reconectar!","color":"gold"}"#;
                            return Self::send_login_disconnect(conn, friendly_msg).await;
                        }
                        Err(HoldError::Failed(status)) => {
                            warn!(
                                server = %route.name,
                                ?status,
                                "Servidor encerrou com falha durante a inicialização na janela de retenção."
                            );
                            return Self::send_login_disconnect(conn, "§cO servidor encerrou com falha durante a inicialização.").await;
                        }
                        Err(HoldError::NotFound) => {
                            return Self::send_login_disconnect(conn, "§cServidor não encontrado.").await;
                        }
                    }
                } else {
                    route
                };

                let server_id = active_route.server_id.clone();
                let subdomain = active_route.subdomain.clone();

                metrics
                    .connections_total
                    .with_label_values(&[&handshake.server_address, "accepted"])
                    .inc();
                metrics
                    .active_sessions_total
                    .with_label_values(&[&server_id, &subdomain])
                    .inc();

                info!(
                    user = %login_start.username,
                    server = %handshake.server_address,
                    route = %active_route.server_id,
                    client_ip = %client_ip,
                    "Iniciando proxy duplex e replay upstream para Login"
                );
                // RF-GW-11: Replay de Handshake + Login Start, PROXY v2 opcional e proxy duplex
                let proxy_res = handle_login_proxy(
                    conn,
                    Some(active_route),
                    handshake,
                    login_start,
                    original_handshake,
                    original_login_start,
                    &session_manager,
                ).await;

                metrics
                    .active_sessions_total
                    .with_label_values(&[&server_id, &subdomain])
                    .dec();

                proxy_res?;
            }
        }

        Ok(())
    }

    /// Envia pacote de Disconnect na fase de Login e encerra a conexão TCP imediatamente (< 50ms).
    pub async fn send_login_disconnect(mut conn: ClientConnection, reason: &str) -> Result<()> {
        use bytes::BytesMut;
        use minecraft_protocol::frame::RawPacket;
        use minecraft_protocol::packets::disconnect::DisconnectPacket;
        use tokio::io::AsyncWriteExt;

        let packet = if reason.trim_start().starts_with('{') {
            DisconnectPacket::from_json(reason)
        } else {
            DisconnectPacket::from_plain_text(reason)
        };
        let mut payload = BytesMut::new();
        packet.encode(&mut payload);

        let raw = RawPacket {
            packet_id: DisconnectPacket::LOGIN_PACKET_ID,
            payload: payload.freeze(),
        };
        let mut wire = BytesMut::new();
        raw.encode(&mut wire);

        conn.stream.write_all(&wire).await?;
        let _ = conn.stream.flush().await;
        let _ = conn.stream.shutdown().await;
        Ok(())
    }
}
