use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_stream::wrappers::ReceiverStream;
use tonic::client::Grpc;
use tonic::codec::ProstCodec;
use tonic::codegen::http::uri::PathAndQuery;
use tonic::transport::{Channel, Endpoint};
use tonic::{Request, Status};
use tracing::{error, info, warn};

use crate::ipc::commands::execute_command;
use crate::ipc::protocol::{
    Empty, GatewayCommand, GatewayCommandResult, ResolvePlayerRequest, ResolvePlayerResponse,
    RouteAction, RouteUpdateEvent, RoutingSnapshotResponse, SessionEventType,
    SessionLifecycleEvent,
};
use crate::routing::{CachedServerRoute, RouteTable, ServerInstanceStatus};
use crate::session::SessionManager;

/// Prazo das chamadas simples. Não pode ser um timeout do canal: ele também valeria para os
/// streams de rotas e de sessões, que ficam abertos por horas e seriam cancelados a cada 10 s.
const UNARY_TIMEOUT: Duration = Duration::from_secs(10);

/// Cliente gRPC de baixo nível para comunicação com o GatewayControlService do Control Plane.
#[derive(Clone)]
pub struct GatewayControlServiceClient {
    inner: Grpc<Channel>,
}

impl GatewayControlServiceClient {
    pub fn new(channel: Channel) -> Self {
        Self {
            inner: Grpc::new(channel),
        }
    }

    pub async fn get_initial_routing_snapshot(
        &mut self,
        mut request: Request<Empty>,
    ) -> Result<tonic::Response<RoutingSnapshotResponse>, Status> {
        request.set_timeout(UNARY_TIMEOUT);
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/GetInitialRoutingSnapshot",
        );
        self.inner.unary(request, path, codec).await
    }

    pub async fn stream_route_updates(
        &mut self,
        request: Request<Empty>,
    ) -> Result<tonic::Response<tonic::Streaming<RouteUpdateEvent>>, Status> {
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/StreamRouteUpdates",
        );
        self.inner.server_streaming(request, path, codec).await
    }

    /// Abre a chamada `StreamSessionEvents` (stream de eventos -> Empty). A resposta só chega quando o
    /// fluxo de entrada termina, então esta futura fica pendente enquanto a conexão estiver saudável.
    pub async fn stream_session_events(
        &mut self,
        events: ReceiverStream<SessionLifecycleEvent>,
    ) -> Result<tonic::Response<Empty>, Status> {
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/StreamSessionEvents",
        );
        self.inner.client_streaming(Request::new(events), path, codec).await
    }

    /// Abre a chamada `StreamCommands`. A resposta (headers) só chega quando o Control Plane tem
    /// algo a dizer, então esta futura pode ficar pendente enquanto a conexão estiver saudável.
    pub async fn stream_commands(
        &mut self,
        results: ReceiverStream<GatewayCommandResult>,
    ) -> Result<tonic::Response<tonic::Streaming<GatewayCommand>>, Status> {
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/StreamCommands",
        );
        self.inner.streaming(Request::new(results), path, codec).await
    }

    pub async fn resolve_player_identity(
        &mut self,
        mut request: Request<ResolvePlayerRequest>,
    ) -> Result<tonic::Response<ResolvePlayerResponse>, Status> {
        request.set_timeout(UNARY_TIMEOUT);
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/ResolvePlayerIdentity",
        );
        self.inner.unary(request, path, codec).await
    }
}

/// Cliente de alto nível para sincronização e resolução de identidade no Gateway L7.
#[derive(Clone)]
pub struct GatewayIpcClient {
    endpoint: String,
    client: GatewayControlServiceClient,
}

impl GatewayIpcClient {
    /// Conecta ao endpoint gRPC do Control Plane (ex: "http://127.0.0.1:50051").
    pub async fn connect(endpoint: impl Into<String>) -> Result<Self, tonic::transport::Error> {
        let endpoint_str = endpoint.into();
        let channel = Endpoint::from_shared(endpoint_str.clone())?
            .connect_timeout(Duration::from_secs(5))
            .http2_keep_alive_interval(Duration::from_secs(30))
            .keep_alive_timeout(Duration::from_secs(10))
            .keep_alive_while_idle(true)
            .connect()
            .await?;

        Ok(Self {
            endpoint: endpoint_str,
            client: GatewayControlServiceClient::new(channel),
        })
    }

    /// Cria o cliente sem conectar: o canal conecta na primeira chamada e reconecta sozinho.
    /// Serve a quem precisa de um cliente antes de o Control Plane estar no ar.
    pub fn connect_lazy(endpoint: impl Into<String>) -> Result<Self, tonic::transport::Error> {
        let endpoint_str = endpoint.into();
        let channel = Endpoint::from_shared(endpoint_str.clone())?
            .connect_timeout(Duration::from_secs(5))
            .http2_keep_alive_interval(Duration::from_secs(30))
            .keep_alive_timeout(Duration::from_secs(10))
            .keep_alive_while_idle(true)
            .connect_lazy();

        Ok(Self {
            endpoint: endpoint_str,
            client: GatewayControlServiceClient::new(channel),
        })
    }

    /// Retorna o endpoint configurado para conexão gRPC.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Cria uma instância a partir de um Channel já estabelecido (útil para testes unitários/mocks).
    pub fn from_channel(channel: Channel) -> Self {
        Self {
            endpoint: "in-memory".into(),
            client: GatewayControlServiceClient::new(channel),
        }
    }

    /// Obtém snapshot completo das rotas e converte para `CachedServerRoute`.
    pub async fn fetch_routing_snapshot(&mut self) -> Result<Vec<CachedServerRoute>, Status> {
        let resp = self
            .client
            .get_initial_routing_snapshot(Request::new(Empty {}))
            .await?;
        let routes = resp
            .into_inner()
            .routes
            .into_iter()
            .map(|event| event.to_cached_route())
            .collect();
        Ok(routes)
    }

    /// Abre stream contínuo de atualizações de rotas emitidas pelo Control Plane.
    pub async fn subscribe_route_updates(&mut self) -> Result<tonic::Streaming<RouteUpdateEvent>, Status> {
        let resp = self
            .client
            .stream_route_updates(Request::new(Empty {}))
            .await?;
        Ok(resp.into_inner())
    }

    /// Consulta a identidade do jogador mapeada pelo Control Plane (Tailscale WhoIs -> Minecraft).
    pub async fn resolve_player_identity(
        &mut self,
        tailscale_user_id: &str,
        node_id: &str,
        client_ip: &str,
    ) -> Result<Option<ResolvePlayerResponse>, Status> {
        let req = ResolvePlayerRequest {
            tailscale_user_id: tailscale_user_id.to_string(),
            node_id: node_id.to_string(),
            client_ip: client_ip.to_string(),
        };

        let resp = self.client.resolve_player_identity(Request::new(req)).await?;
        let inner = resp.into_inner();
        if inner.found {
            Ok(Some(inner))
        } else {
            Ok(None)
        }
    }

    /// Publica no Control Plane os eventos de sessão, reconectando sozinho.
    ///
    /// A cada (re)conexão o estado conhecido pelo Control Plane é tratado como perdido: o backlog
    /// acumulado é descartado e as sessões realmente abertas são reanunciadas como CONNECTED.
    /// Pedidos de wake pendentes são preservados, pois ainda há jogadores esperando por eles.
    pub async fn run_session_events_loop(
        self,
        sessions: SessionManager,
        mut events_rx: mpsc::UnboundedReceiver<SessionLifecycleEvent>,
        mut shutdown_rx: watch::Receiver<bool>,
    ) {
        info!("Iniciando publicação de eventos de sessão para o Control Plane...");
        let mut client = self.client.clone();

        while !*shutdown_rx.borrow() {
            let mut pending_wakes = Vec::new();
            while let Ok(event) = events_rx.try_recv() {
                if event.event_type == SessionEventType::WakeRequested as i32 {
                    pending_wakes.push(event);
                }
            }

            let (tx, rx) = mpsc::channel::<SessionLifecycleEvent>(256);
            for event in sessions.connected_events().into_iter().chain(pending_wakes) {
                let _ = tx.send(event).await;
            }

            {
                let mut call = Box::pin(client.stream_session_events(ReceiverStream::new(rx)));
                info!("Stream de eventos de sessão aberto com o Control Plane.");
                loop {
                    tokio::select! {
                        result = &mut call => {
                            match result {
                                Ok(_) => warn!("Control Plane encerrou o stream de eventos de sessão."),
                                Err(e) => warn!(error = %e, "Stream de eventos de sessão interrompido."),
                            }
                            break;
                        }
                        event = events_rx.recv() => match event {
                            Some(event) => {
                                if tx.send(event).await.is_err() {
                                    break;
                                }
                            }
                            None => return,
                        },
                        _ = shutdown_rx.changed() => {
                            if *shutdown_rx.borrow() {
                                return;
                            }
                        }
                    }
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(3)) => {},
                _ = shutdown_rx.changed() => break,
            }
        }

        info!("Publicação de eventos de sessão finalizada ordenadamente.");
    }

    /// Recebe os comandos do Control Plane (Smart Kick, ban de rede), executa cada um nas sessões do
    /// Gateway e devolve o resultado pelo mesmo stream, reconectando sozinho.
    ///
    /// Comando nenhum é enfileirado enquanto o stream está fora: quem o enviou recebe um erro do
    /// Control Plane, e um kick executado minutos depois derrubaria uma sessão legítima.
    pub async fn run_commands_loop(self, sessions: SessionManager, mut shutdown_rx: watch::Receiver<bool>) {
        info!("Iniciando canal de comandos com o Control Plane...");
        let mut client = self.client.clone();

        while !*shutdown_rx.borrow() {
            let (tx, rx) = mpsc::channel::<GatewayCommandResult>(32);
            let opened = tokio::select! {
                result = client.stream_commands(ReceiverStream::new(rx)) => result,
                _ = shutdown_requested(&mut shutdown_rx) => return,
            };

            match opened {
                Ok(response) => {
                    let mut commands = response.into_inner();
                    info!("Canal de comandos aberto com o Control Plane.");
                    loop {
                        tokio::select! {
                            message = commands.message() => match message {
                                Ok(Some(command)) => {
                                    let result = execute_command(&sessions, command);
                                    if tx.send(result).await.is_err() {
                                        break;
                                    }
                                }
                                Ok(None) => {
                                    warn!("Control Plane encerrou o canal de comandos.");
                                    break;
                                }
                                Err(e) => {
                                    warn!(error = %e, "Canal de comandos interrompido.");
                                    break;
                                }
                            },
                            _ = shutdown_requested(&mut shutdown_rx) => return,
                        }
                    }
                }
                Err(e) => warn!(error = %e, "Falha ao abrir o canal de comandos."),
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(3)) => {},
                _ = shutdown_requested(&mut shutdown_rx) => break,
            }
        }

        info!("Canal de comandos finalizado ordenadamente.");
    }

    /// Loop resiliente de sincronização de rotas com reconexão automática e reconstrução de snapshot.
    pub async fn run_sync_loop(
        mut self,
        route_table: RouteTable,
        mut shutdown_rx: watch::Receiver<bool>,
    ) {
        info!("Iniciando loop de sincronização gRPC com Control Plane...");

        while !*shutdown_rx.borrow() {
            // 1. Sincronização inicial do snapshot de rotas
            match self.fetch_routing_snapshot().await {
                Ok(snapshot) => {
                    info!(
                        routes_count = snapshot.len(),
                        "Snapshot de rotas reconstruído com sucesso via IPC gRPC"
                    );
                    route_table.rebuild_from_snapshot(snapshot);
                }
                Err(e) => {
                    warn!(error = %e, "Falha ao obter snapshot de rotas gRPC. Tentando novamente em 3s...");
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(3)) => continue,
                        _ = shutdown_rx.changed() => break,
                    }
                }
            }

            // 2. Assinatura contínua do stream de eventos
            match self.subscribe_route_updates().await {
                Ok(mut stream) => {
                    info!("Stream de atualizações de rotas conectado ao Control Plane.");
                    loop {
                        tokio::select! {
                            _ = shutdown_rx.changed() => {
                                if *shutdown_rx.borrow() {
                                    return;
                                }
                            }
                            item = stream.message() => {
                                match item {
                                    Ok(Some(event)) => {
                                        apply_route_update_event(&route_table, event);
                                    }
                                    Ok(None) => {
                                        warn!("Stream gRPC de rotas fechado pelo servidor remoto.");
                                        break;
                                    }
                                    Err(e) => {
                                        error!(error = %e, "Erro durante recepção no stream gRPC de rotas.");
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Falha ao assinar stream de atualizações de rotas. Reconectando em 3s...");
                }
            }

            // Backoff antes de tentar reconectar o stream / snapshot
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(3)) => {},
                _ = shutdown_rx.changed() => break,
            }
        }

        info!("Loop de sincronização gRPC finalizado ordenadamente.");
    }
}

/// Resolve quando o shutdown é pedido. Devolve `()` porque o `Ref` do `watch` não é `Send`
/// e não pode atravessar o `select!` de uma tarefa spawnada.
async fn shutdown_requested(shutdown_rx: &mut watch::Receiver<bool>) {
    let _ = shutdown_rx.wait_for(|stop| *stop).await;
}

/// Aplica um evento de atualização na RouteTable em memória.
pub fn apply_route_update_event(route_table: &RouteTable, event: RouteUpdateEvent) {
    match event.action {
        action if action == RouteAction::Upsert as i32 => {
            let route = event.to_cached_route();
            info!(server_id = %route.server_id, "IPC: Inserindo/Atualizando rota");
            route_table.insert(route);
        }
        action if action == RouteAction::Delete as i32 => {
            info!(server_id = %event.server_id, "IPC: Removendo rota");
            route_table.remove(&event.server_id);
        }
        action if action == RouteAction::StatusChange as i32 => {
            info!(server_id = %event.server_id, status = %event.status, "IPC: Atualizando status da rota");
            if let Some(mut existing) = route_table.get_by_server_id(&event.server_id) {
                existing.status = ServerInstanceStatus::from(event.status.as_str());
                if !event.target_ip_port.is_empty() {
                    existing.target_addr = event.target_ip_port.parse().ok();
                }
                route_table.insert(existing);
            }
        }
        _ => {
            warn!(action = event.action, "Ação de rota desconhecida recebida no IPC");
        }
    }
}
