use std::time::Duration;
use tokio::sync::watch;
use tonic::client::Grpc;
use tonic::codec::ProstCodec;
use tonic::codegen::http::uri::PathAndQuery;
use tonic::transport::{Channel, Endpoint};
use tonic::{Request, Status};
use tracing::{error, info, warn};

use crate::ipc::protocol::{
    Empty, ResolvePlayerRequest, ResolvePlayerResponse, RevokeSessionRequest,
    RevokeSessionResponse, RouteAction, RouteUpdateEvent, RoutingSnapshotResponse,
};
use crate::routing::{CachedServerRoute, RouteTable, ServerInstanceStatus};

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
        request: Request<Empty>,
    ) -> Result<tonic::Response<RoutingSnapshotResponse>, Status> {
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

    pub async fn revoke_player_session(
        &mut self,
        request: Request<RevokeSessionRequest>,
    ) -> Result<tonic::Response<RevokeSessionResponse>, Status> {
        self.inner.ready().await.map_err(|e| {
            Status::unknown(format!("GatewayControlService indisponível: {}", e))
        })?;
        let codec = ProstCodec::default();
        let path = PathAndQuery::from_static(
            "/minekubernetes.gateway.v1.GatewayControlService/RevokePlayerSession",
        );
        self.inner.unary(request, path, codec).await
    }

    pub async fn resolve_player_identity(
        &mut self,
        request: Request<ResolvePlayerRequest>,
    ) -> Result<tonic::Response<ResolvePlayerResponse>, Status> {
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
            .timeout(Duration::from_secs(10))
            .connect()
            .await?;

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
