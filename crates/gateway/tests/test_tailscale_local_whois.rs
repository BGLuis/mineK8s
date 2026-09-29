use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixListener;
use gateway::identity::{TailscaleLocalWhoIs, WhoIsCache, WhoIsIdentity};

/// Acceptance Criterion: "Mock de Unix socket responde em < 5 ms; ENOENT aciona fallback" (RF-GW-08, RF-TS-05).
#[tokio::test]
async fn test_unix_socket_whois_under_5ms_and_cache() {
    let socket_path = PathBuf::from(format!(
        "/tmp/test-gw-tailscaled-{}-{}.sock",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));

    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path).expect("Falha ao criar UnixListener para mock");
    let sock_path_clone = socket_path.clone();

    // Mock do daemon tailscaled escutando no Unix Domain Socket
    let server_task = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let req_str = String::from_utf8_lossy(&buf[..n]);

                if req_str.contains("/localapi/v0/whois?addr=") {
                    let payload = r#"{
                        "Node": {
                            "ID": 5001,
                            "StableID": "node-mock-5001",
                            "Name": "alex-pc.tailnet.ts.net.",
                            "User": 99,
                            "Addresses": ["100.64.0.77"],
                            "Tags": ["tag:mc-player"]
                        },
                        "UserProfile": {
                            "ID": 99,
                            "LoginName": "alex@mine.lan",
                            "DisplayName": "Alex Architect"
                        }
                    }"#;

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        payload.len(),
                        payload
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            });
        }
    });

    let driver = TailscaleLocalWhoIs::new(&socket_path).with_cache_ttl(Duration::from_secs(60));

    // Warmup inicial da conexão tokio
    let _ = driver.query_whois("100.64.0.77").await.unwrap();

    // Invalida cache para medir a latência real sobre o Unix Domain Socket
    driver.cache().invalidate("100.64.0.77");

    let start = Instant::now();
    let identity = driver
        .query_whois("100.64.0.77")
        .await
        .expect("Consulta WhoIs deve suceder")
        .expect("Identidade deve ser encontrada");
    let elapsed = start.elapsed();

    // 1. Asserção do critério de aceite: mock de Unix Socket responde em < 5 ms
    assert!(
        elapsed < Duration::from_millis(5),
        "Latência sobre Unix socket deve ser < 5ms, obtido: {:?}",
        elapsed
    );

    // 2. Validação dos campos mapeados
    assert_eq!(identity.login_name, "alex@mine.lan");
    assert_eq!(identity.display_name, "Alex Architect");
    assert_eq!(identity.node_id, "node-mock-5001");
    assert_eq!(identity.user_id, "99");
    assert_eq!(identity.tags, vec!["tag:mc-player"]);
    assert_eq!(identity.client_ip, "100.64.0.77");

    // 3. Consulta subsequente deve ser atendida pelo cache em memória (< 1 ms)
    let cache_start = Instant::now();
    let cached = driver
        .query_whois("100.64.0.77")
        .await
        .unwrap()
        .unwrap();
    let cache_elapsed = cache_start.elapsed();

    assert_eq!(cached, identity);
    assert!(
        cache_elapsed < Duration::from_millis(1),
        "Cache hit em memória deve ser < 1ms, obtido: {:?}",
        cache_elapsed
    );

    server_task.abort();
    let _ = std::fs::remove_file(&sock_path_clone);
}

/// Acceptance Criterion: "ENOENT aciona fallback" (RF-TS-14, RF-GW-08).
#[tokio::test]
async fn test_enoent_triggers_fallback() {
    let non_existent_socket = PathBuf::from("/tmp/non-existent-tailscaled-socket-12345.sock");
    let driver = TailscaleLocalWhoIs::new(&non_existent_socket);

    // 1. Consulta direta ao socket inexistente deve falhar com ENOENT (NotFound)
    let direct_result = driver.query_whois("100.64.0.88").await;
    assert!(
        direct_result.is_err(),
        "Socket inexistente deve retornar erro de I/O"
    );
    let err = direct_result.unwrap_err();
    assert_eq!(
        err.kind(),
        std::io::ErrorKind::NotFound,
        "Erro deve ser ENOENT (NotFound)"
    );

    // 2. Com query_with_fallback sem IPC client, não deve entrar em pânico e retornar None graciosamente
    let fallback_none = driver.query_with_fallback("100.64.0.88", None).await;
    assert!(fallback_none.is_none());
}

/// Valida operações e expiração de TTL do WhoIsCache.
#[test]
fn test_whois_cache_ttl_and_operations() {
    let cache = WhoIsCache::new(Duration::from_millis(50));

    let identity = WhoIsIdentity {
        user_id: "usr-1".into(),
        login_name: "test@mine.lan".into(),
        display_name: "Tester".into(),
        node_id: "node-1".into(),
        tags: vec![],
        client_ip: "100.64.0.1".into(),
    };

    cache.insert("100.64.0.1".into(), identity.clone());
    assert_eq!(cache.len(), 1);
    assert!(cache.get("100.64.0.1").is_some());

    // Invalidação manual
    cache.invalidate("100.64.0.1");
    assert!(cache.get("100.64.0.1").is_none());

    // Expiração por TTL
    cache.insert("100.64.0.1".into(), identity);
    std::thread::sleep(Duration::from_millis(60));
    assert!(cache.get("100.64.0.1").is_none(), "Entrada expirada por TTL deve retornar None");
}
