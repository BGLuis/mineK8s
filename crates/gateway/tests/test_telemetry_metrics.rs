use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use gateway::telemetry::{GatewayMetrics, TelemetryServer};

/// Critério de aceite da Issue #54 (RF-GW-17, GW:523-552):
/// "Métricas do catálogo GW §9.1 expostas."
/// Valida que o endpoint `/metrics` expõe todas as quatro famílias de métricas do catálogo oficial
/// e que o endpoint `/healthz` responde HTTP 200 OK.
#[tokio::test]
async fn test_telemetry_metrics_and_healthz_exposed() {
    let metrics = Arc::new(GatewayMetrics::new());

    // Simular algumas contagens de métricas
    metrics
        .active_sessions_total
        .with_label_values(&["srv-survival", "survival.mine.lan"])
        .set(3);
    metrics
        .connections_total
        .with_label_values(&["survival.mine.lan", "accepted"])
        .inc_by(42);
    metrics
        .bytes_transferred_total
        .with_label_values(&["rx", "srv-survival"])
        .inc_by(102400);
    metrics
        .bytes_transferred_total
        .with_label_values(&["tx", "srv-survival"])
        .inc_by(204800);
    metrics.handshake_duration_seconds.observe(0.0035);

    // Iniciar TelemetryServer em porta efêmera
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server = TelemetryServer::new(Arc::clone(&metrics));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(listener, shutdown_rx).await;
    });

    // 1. Validar endpoint /healthz
    let mut healthz_stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    healthz_stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();

    let mut healthz_buf = [0u8; 512];
    let n = healthz_stream.read(&mut healthz_buf).await.unwrap();
    let healthz_response = String::from_utf8_lossy(&healthz_buf[..n]);

    assert!(
        healthz_response.starts_with("HTTP/1.1 200 OK"),
        "Endpoint /healthz deve responder 200 OK"
    );
    assert!(healthz_response.contains("OK\n"));

    // 2. Validar endpoint /metrics
    let mut metrics_stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    metrics_stream
        .write_all(b"GET /metrics HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();

    let mut metrics_buf = Vec::new();
    let mut temp = [0u8; 1024];
    loop {
        let n = metrics_stream.read(&mut temp).await.unwrap();
        if n == 0 {
            break;
        }
        metrics_buf.extend_from_slice(&temp[..n]);
    }
    let metrics_response = String::from_utf8_lossy(&metrics_buf);

    assert!(
        metrics_response.starts_with("HTTP/1.1 200 OK"),
        "Endpoint /metrics deve responder 200 OK"
    );

    // Validação estrita das 4 métricas do catálogo GW §9.1
    assert!(
        metrics_response.contains("minecraft_gateway_active_sessions_total"),
        "Deve conter a métrica minecraft_gateway_active_sessions_total"
    );
    assert!(
        metrics_response.contains("minecraft_gateway_connections_total"),
        "Deve conter a métrica minecraft_gateway_connections_total"
    );
    assert!(
        metrics_response.contains("minecraft_gateway_bytes_transferred_total"),
        "Deve conter a métrica minecraft_gateway_bytes_transferred_total"
    );
    assert!(
        metrics_response.contains("minecraft_gateway_handshake_duration_seconds"),
        "Deve conter a métrica minecraft_gateway_handshake_duration_seconds"
    );

    // Validação dos labels
    assert!(metrics_response.contains("survival.mine.lan"));
    assert!(metrics_response.contains("srv-survival"));

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}
