use std::fs;
use tokio::net::TcpListener;
use tokio::sync::watch;

use gateway::{GatewayConfig, GatewayServer};

/// Protocolo formal de medição de memória em repouso (RNF-GW-02, critério de aceite da Issue #50).
/// Lê o RSS (Resident Set Size) a partir de `/proc/self/statm` e valida que a pegada de memória
/// do Gateway em repouso é estritamente inferior a 30 MB.
#[tokio::test]
async fn test_measure_idle_memory_protocol() {
    let config = GatewayConfig::default();
    let server = GatewayServer::new(config);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_handle = tokio::spawn(async move {
        let _ = server.run(listener, shutdown_rx).await;
    });

    // Aguardar o runtime Tokio estabilizar suas threads em repouso
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Medição via /proc/self/statm no Linux
    let statm_path = "/proc/self/statm";
    if let Ok(statm_content) = fs::read_to_string(statm_path) {
        let parts: Vec<&str> = statm_content.split_whitespace().collect();
        if parts.len() >= 2 {
            let resident_pages: u64 = parts[1]
                .parse()
                .expect("Falha ao analisar páginas residentes");
            // Tamanho de página padrão no Linux: 4096 bytes (4 KB)
            let page_size_bytes = 4096u64;
            let resident_bytes = resident_pages * page_size_bytes;
            let resident_mb = (resident_bytes as f64) / (1024.0 * 1024.0);

            println!("\n========================================================");
            println!("  PROTOCOLO DE MEDIÇÃO DE MEMÓRIA EM REPOUSO (RNF-GW-02)");
            println!("========================================================");
            println!("  Páginas residentes (RSS): {}", resident_pages);
            println!("  Tamanho da página: {} bytes", page_size_bytes);
            println!("  Memória RSS em repouso: {:.2} MB", resident_mb);
            println!("  Limite máximo especificado: 30.00 MB");
            println!("========================================================\n");

            assert!(
                resident_mb < 30.0,
                "Memória em repouso ({:.2} MB) excedeu o teto estrito de 30 MB (RNF-GW-02)",
                resident_mb
            );
        }
    } else {
        println!("Aviso: /proc/self/statm não disponível neste ambiente para medição.");
    }

    // Encerrar servidor
    let _ = shutdown_tx.send(true);
    let _ = server_handle.await;
}
