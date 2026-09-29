use prometheus::{
    Encoder, Histogram, HistogramOpts, IntCounterVec, IntGaugeVec, Opts, Registry, TextEncoder,
};
use std::sync::Arc;

/// Métricas oficiais do Catálogo do Gateway L7 (GW §9.1, RF-GW-17).
#[derive(Clone)]
pub struct GatewayMetrics {
    pub registry: Arc<Registry>,
    pub active_sessions_total: IntGaugeVec,
    pub connections_total: IntCounterVec,
    pub bytes_transferred_total: IntCounterVec,
    pub handshake_duration_seconds: Histogram,
}

impl Default for GatewayMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl GatewayMetrics {
    pub fn new() -> Self {
        let registry = Registry::new();

        // 1. minecraft_gateway_active_sessions_total{server_id, subdomain}
        let active_sessions_opts = Opts::new(
            "minecraft_gateway_active_sessions_total",
            "Número de sessões TCP atualmente ativas no proxy",
        );
        let active_sessions_total =
            IntGaugeVec::new(active_sessions_opts, &["server_id", "subdomain"])
                .expect("Falha ao criar active_sessions_total");
        registry
            .register(Box::new(active_sessions_total.clone()))
            .expect("Falha ao registrar active_sessions_total");

        // 2. minecraft_gateway_connections_total{subdomain, status}
        let connections_opts = Opts::new(
            "minecraft_gateway_connections_total",
            "Total acumulado de tentativas de conexão recebidas",
        );
        let connections_total =
            IntCounterVec::new(connections_opts, &["subdomain", "status"])
                .expect("Falha ao criar connections_total");
        registry
            .register(Box::new(connections_total.clone()))
            .expect("Falha ao registrar connections_total");

        // 3. minecraft_gateway_bytes_transferred_total{direction, server_id}
        let bytes_opts = Opts::new(
            "minecraft_gateway_bytes_transferred_total",
            "Total acumulado de bytes transferidos pelo proxy",
        );
        let bytes_transferred_total =
            IntCounterVec::new(bytes_opts, &["direction", "server_id"])
                .expect("Falha ao criar bytes_transferred_total");
        registry
            .register(Box::new(bytes_transferred_total.clone()))
            .expect("Falha ao registrar bytes_transferred_total");

        // 4. minecraft_gateway_handshake_duration_seconds
        let handshake_opts = HistogramOpts::new(
            "minecraft_gateway_handshake_duration_seconds",
            "Latência de processamento do handshake e autorização",
        )
        .buckets(vec![
            0.001, 0.005, 0.010, 0.025, 0.050, 0.100, 0.250, 0.500, 1.0, 2.5, 5.0,
        ]);
        let handshake_duration_seconds =
            Histogram::with_opts(handshake_opts).expect("Falha ao criar handshake_duration_seconds");
        registry
            .register(Box::new(handshake_duration_seconds.clone()))
            .expect("Falha ao registrar handshake_duration_seconds");

        Self {
            registry: Arc::new(registry),
            active_sessions_total,
            connections_total,
            bytes_transferred_total,
            handshake_duration_seconds,
        }
    }

    /// Renderiza as métricas no formato canônico texto do Prometheus (versão 0.0.4).
    pub fn encode_text(&self) -> String {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder
            .encode(&metric_families, &mut buffer)
            .expect("Falha ao codificar métricas Prometheus");
        String::from_utf8(buffer).unwrap_or_default()
    }
}
