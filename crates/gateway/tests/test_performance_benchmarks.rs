use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::{BufMut, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use gateway::routing::{CachedServerRoute, RouteTable, RoutingModel, ServerInstanceStatus};
use gateway::session::SessionManager;
use gateway::{GatewayConfig, GatewayServer};

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::packets::ping::{PingRequestPacket, PongResponsePacket};
use minecraft_protocol::types::varint::VarInt;
use minecraft_protocol::ProtocolError;

/// Helper assíncrono para decodificar um RawPacket completo a partir de uma stream TCP,
/// lidando corretamente com fragmentação e consumo de buffer.
async fn read_prelogin_packet(
    stream: &mut tokio::net::TcpStream,
    buffer: &mut BytesMut,
) -> std::io::Result<RawPacket> {
    loop {
        let initial_len = buffer.len();
        if initial_len > 0 {
            let mut cursor = &buffer[..];
            match RawPacket::decode_prelogin(&mut cursor) {
                Ok(packet) => {
                    let consumed = initial_len - cursor.len();
                    let _ = buffer.split_to(consumed);
                    return Ok(packet);
                }
                Err(ProtocolError::UnexpectedEof) => {}
                Err(err) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("{:?}", err),
                    ))
                }
            }
        }
        let n = stream.read_buf(buffer).await?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Stream TCP encerrada prematuramente",
            ));
        }
    }
}

/// Helper para envio de Handshake e LoginStart padrão do Minecraft.
async fn send_login(stream: &mut tokio::net::TcpStream, port: u16, host: &str, nick: &str) {
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: host.into(),
        server_port: port,
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let mut wire = BytesMut::new();
    VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&hs_payload);

    let login = LoginStartPacket::new(nick).unwrap();
    let mut login_payload = BytesMut::new();
    login.encode(&mut login_payload);

    VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
    VarInt(0x00).encode(&mut wire);
    wire.put_slice(&login_payload);

    stream.write_all(&wire).await.unwrap();
}

/// 1. Benchmark de Sobrecarga de Latência RTT (Forwarding Overhead & Jitter):
/// Compara 500 pings diretos (Cliente <-> Servidor) vs 500 pings através do Gateway (Cliente <-> Gateway <-> Servidor).
/// Garante que o overhead adicionado pelo proxy seja sub-milissegundo (p50 < 0.5 ms, p99 < 2.0 ms).
#[tokio::test]
async fn bench_proxy_forwarding_latency_overhead() {
    // 1. Mock de Servidor de Jogo (eco de pacotes de 64 bytes após pre-login)
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            tokio::spawn(async move {
                let mut buf = BytesMut::with_capacity(1024);
                // Consumir Handshake e LoginStart
                if read_prelogin_packet(&mut stream, &mut buf).await.is_err() {
                    return;
                }
                if read_prelogin_packet(&mut stream, &mut buf).await.is_err() {
                    return;
                }

                // Enviar 1 byte de ACK confirmando login e prontidão para eco
                if stream.write_all(&[0x02]).await.is_err() {
                    return;
                }

                // Loop de eco transparente de pacotes de jogo (latência RTT)
                let mut echo_buf = [0u8; 1024];
                loop {
                    let n = match stream.read(&mut echo_buf).await {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(_) => break,
                    };
                    if stream.write_all(&echo_buf[..n]).await.is_err() {
                        break;
                    }
                }
            });
        }
    });

    // 2. Gateway L7 configurado para proxying
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-perf".into(),
        name: "Performance Test Server".into(),
        subdomain: "perf.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 100,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let mut config = GatewayConfig::default();
    config.rate_limit_per_second = 50_000;
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    // 3. Medição Direta (Baseline sem Gateway)
    let mut direct_stream = tokio::net::TcpStream::connect(upstream_addr).await.unwrap();
    send_login(
        &mut direct_stream,
        upstream_addr.port(),
        "direct.mine.lan",
        "DirectUser",
    )
    .await;

    // Aguardar confirmação de login
    let mut ack = [0u8; 1];
    direct_stream.read_exact(&mut ack).await.unwrap();

    let iterations = 500;
    let mut direct_latencies = Vec::with_capacity(iterations);
    let ping_payload = [0xAAu8; 64];
    let mut echo_buf = [0u8; 64];

    for _ in 0..iterations {
        let t0 = Instant::now();
        direct_stream.write_all(&ping_payload).await.unwrap();
        direct_stream.read_exact(&mut echo_buf).await.unwrap();
        direct_latencies.push(t0.elapsed());
    }

    // 4. Medição Através do Gateway L7
    let mut gateway_stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
    send_login(
        &mut gateway_stream,
        gateway_addr.port(),
        "perf.mine.lan",
        "BenchmarkUser",
    )
    .await;

    // Aguardar confirmação de login através do Gateway L7
    gateway_stream.read_exact(&mut ack).await.unwrap();

    let mut proxied_latencies = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let t0 = Instant::now();
        gateway_stream.write_all(&ping_payload).await.unwrap();
        gateway_stream.read_exact(&mut echo_buf).await.unwrap();
        proxied_latencies.push(t0.elapsed());
    }

    // 5. Cálculos Estatísticos (p50, p90, p99)
    direct_latencies.sort();
    proxied_latencies.sort();

    let direct_p50 = direct_latencies[iterations * 50 / 100];
    let direct_p99 = direct_latencies[iterations * 99 / 100];

    let proxied_p50 = proxied_latencies[iterations * 50 / 100];
    let proxied_p99 = proxied_latencies[iterations * 99 / 100];

    let overhead_p50 = proxied_p50.saturating_sub(direct_p50);
    let overhead_p99 = proxied_p99.saturating_sub(direct_p99);

    println!("\n========================================================");
    println!("  1. BENCHMARK DE OVERHEAD DE LATÊNCIA (500 AMOSTRAS)");
    println!("========================================================");
    println!(
        "  Direto Baseline  p50: {:>7.2?} | p99: {:>7.2?}",
        direct_p50, direct_p99
    );
    println!(
        "  Com Gateway L7   p50: {:>7.2?} | p99: {:>7.2?}",
        proxied_p50, proxied_p99
    );
    println!(
        "  OVERHEAD ADICIONADO p50: {:>7.2?} (Meta: < 500 µs)",
        overhead_p50
    );
    println!(
        "  OVERHEAD ADICIONADO p99: {:>7.2?} (Meta: < 2.0 ms)",
        overhead_p99
    );
    println!("========================================================\n");

    assert!(
        overhead_p50 < Duration::from_micros(500),
        "Overhead p50 ({:?}) excedeu 500 µs",
        overhead_p50
    );
    assert!(
        overhead_p99 < Duration::from_millis(2),
        "Overhead p99 ({:?}) excedeu 2.0 ms",
        overhead_p99
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// 2. Stress Test de Throughput Contínuo (Simulação de Streaming de Chunks e Modpacks):
/// Transfere 100 MB contínuos através do pipe duplex do Gateway e calcula MB/s.
#[tokio::test]
async fn bench_duplex_proxy_throughput() {
    let total_bytes: usize = 100 * 1024 * 1024; // 100 MB
    let chunk_size: usize = 64 * 1024; // 64 KB por write

    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock upstream que consome os 100 MB
    let upstream_task = tokio::spawn(async move {
        let (mut stream, _) = upstream_listener.accept().await.unwrap();
        let mut buf = BytesMut::with_capacity(1024);
        let _ = read_prelogin_packet(&mut stream, &mut buf).await;
        let _ = read_prelogin_packet(&mut stream, &mut buf).await;

        let mut sink = vec![0u8; chunk_size];
        let mut received = 0;
        while received < total_bytes {
            let n = stream.read(&mut sink).await.unwrap();
            if n == 0 {
                break;
            }
            received += n;
        }
        received
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-throughput".into(),
        name: "Throughput Server".into(),
        subdomain: "throughput.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 100,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let mut config = GatewayConfig::default();
    config.rate_limit_per_second = 50_000;
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let mut client_stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
    send_login(
        &mut client_stream,
        gateway_addr.port(),
        "throughput.mine.lan",
        "ChunkLoader",
    )
    .await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Disparar envio de 100 MB
    let buffer = vec![0x55u8; chunk_size];
    let start = Instant::now();
    let mut sent = 0;
    while sent < total_bytes {
        client_stream.write_all(&buffer).await.unwrap();
        sent += chunk_size;
    }

    let received = upstream_task.await.unwrap();
    let elapsed = start.elapsed();
    let mb_transferred = (received as f64) / (1024.0 * 1024.0);
    let throughput_mb_s = mb_transferred / elapsed.as_secs_f64();

    println!("\n========================================================");
    println!("  2. BENCHMARK DE THROUGHPUT CONTÍNUO (STREAMING CHUNKS)");
    println!("========================================================");
    println!("  Total transferido: {:.2} MB", mb_transferred);
    println!("  Tempo decorrido:   {:.3} s", elapsed.as_secs_f64());
    println!(
        "  Throughput real:   {:.2} MB/s (Meta: > 300 MB/s)",
        throughput_mb_s
    );
    println!("========================================================\n");

    assert!(
        throughput_mb_s > 300.0,
        "Throughput ({:.2} MB/s) abaixo da meta mínima de 300 MB/s",
        throughput_mb_s
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// 3. Taxa de Server List Ping sob Rajada Concorrente (CPS - Connections Per Second):
/// Executa 200 conexões paralelas efetuando o ciclo completo de Server List Ping (Status + Ping/Pong).
#[tokio::test]
async fn bench_server_list_ping_burst() {
    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-ping".into(),
        name: "Ping Hub".into(),
        subdomain: "ping.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: None,
        status: ServerInstanceStatus::Stopped, // MOTD sintético imediato em memória
        proxy_protocol_upstream: false,
        max_players: 50,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let mut config = GatewayConfig::default();
    config.rate_limit_per_second = 100_000; // Desativa limitação local para o teste de rajada
    let server = GatewayServer::new(config).with_route_table(route_table);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let total_requests = 500;
    let completed = Arc::new(AtomicUsize::new(0));
    let sem = Arc::new(tokio::sync::Semaphore::new(64));

    let start = Instant::now();
    let mut tasks = Vec::with_capacity(total_requests);

    for _ in 0..total_requests {
        let completed_clone = Arc::clone(&completed);
        let sem_clone = Arc::clone(&sem);
        tasks.push(tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();
            let mut stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();

            // Handshake (Status)
            let handshake = HandshakePacket {
                protocol_version: VarInt(765),
                server_address: "ping.mine.lan".into(),
                server_port: gateway_addr.port(),
                next_state: HandshakeNextState::Status,
            };
            let mut hs_payload = BytesMut::new();
            handshake.encode(&mut hs_payload);

            let mut wire = BytesMut::new();
            VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
            VarInt(0x00).encode(&mut wire);
            wire.put_slice(&hs_payload);

            // Status Request
            VarInt(1).encode(&mut wire);
            VarInt(0x00).encode(&mut wire);

            stream.write_all(&wire).await.unwrap();

            let mut buf = BytesMut::with_capacity(512);
            // Ler Status Response
            let _ = read_prelogin_packet(&mut stream, &mut buf).await.unwrap();

            // Enviar Ping Request imediatamente (ciclo completo do protocolo Minecraft)
            let ping_pkt = PingRequestPacket::new(12345678);
            let mut ping_payload = BytesMut::new();
            ping_pkt.encode(&mut ping_payload);
            let raw_ping = RawPacket {
                packet_id: PingRequestPacket::PACKET_ID,
                payload: ping_payload.freeze(),
            };
            let mut ping_wire = BytesMut::new();
            raw_ping.encode(&mut ping_wire);
            stream.write_all(&ping_wire).await.unwrap();

            // Ler Pong Response
            let pong_raw = read_prelogin_packet(&mut stream, &mut buf).await.unwrap();
            assert_eq!(pong_raw.packet_id, PongResponsePacket::PACKET_ID);

            completed_clone.fetch_add(1, Ordering::SeqCst);
        }));
    }

    for task in tasks {
        task.await.unwrap();
    }

    let elapsed = start.elapsed();
    let count = completed.load(Ordering::SeqCst);
    let cps = (count as f64) / elapsed.as_secs_f64();

    println!("\n========================================================");
    println!("  3. BENCHMARK DE RAJADA DE SERVER LIST PING");
    println!("========================================================");
    println!("  Conexões concluídas: {}", count);
    println!("  Tempo total:         {:.3} s", elapsed.as_secs_f64());
    println!(
        "  Taxa de Conexões:    {:.1} pings/s (Meta: > 1.000 CPS)",
        cps
    );
    println!("========================================================\n");

    assert_eq!(
        count, total_requests,
        "Todas as requisições devem ser atendidas"
    );
    assert!(
        cps > 1000.0,
        "Taxa CPS ({:.1}) abaixo da meta de 1.000",
        cps
    );

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}

/// 4. Escalabilidade Concorrente & Pegada de Memória sob Carga:
/// Abre 50 conexões de proxy duplex simultâneas e valida que o consumo RSS de RAM permanece < 30 MB.
#[tokio::test]
async fn bench_memory_under_concurrent_load() {
    let upstream_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream_listener.local_addr().unwrap();

    // Mock upstream mantendo 50 conexões abertas
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = upstream_listener.accept().await {
            tokio::spawn(async move {
                let mut buf = BytesMut::with_capacity(1024);
                let _ = read_prelogin_packet(&mut stream, &mut buf).await;
                let _ = read_prelogin_packet(&mut stream, &mut buf).await;

                // Ecoa continuamente
                let mut sink = [0u8; 128];
                while let Ok(n) = stream.read(&mut sink).await {
                    if n == 0 {
                        break;
                    }
                    let _ = stream.write_all(&sink[..n]).await;
                }
            });
        }
    });

    let gateway_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gateway_addr = gateway_listener.local_addr().unwrap();

    let route_table = RouteTable::new();
    let route = CachedServerRoute {
        server_id: "srv-scale".into(),
        name: "Scale Hub".into(),
        subdomain: "scale.mine.lan".into(),
        listener_port: gateway_addr.port(),
        routing_model: RoutingModel::VirtualHost,
        target_addr: Some(upstream_addr.into()),
        status: ServerInstanceStatus::Ready,
        proxy_protocol_upstream: false,
        max_players: 500,
        protocol_version: 765,
        ..Default::default()
    };
    route_table.insert(route);

    let session_mgr = SessionManager::new();
    let mut config = GatewayConfig::default();
    config.rate_limit_per_second = 50_000;
    let server = GatewayServer::new(config)
        .with_route_table(route_table)
        .with_session_manager(session_mgr.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_task = tokio::spawn(async move {
        let _ = server.run(gateway_listener, shutdown_rx).await;
    });

    let concurrent_clients = 50;
    let mut client_streams = Vec::with_capacity(concurrent_clients);

    for i in 0..concurrent_clients {
        let mut stream = tokio::net::TcpStream::connect(gateway_addr).await.unwrap();
        let nick = format!("Player_{}", i);
        send_login(&mut stream, gateway_addr.port(), "scale.mine.lan", &nick).await;
        client_streams.push(stream);
    }

    // Aguardar todas as 50 conexões estabelecerem o proxy ativo
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        session_mgr.active_count(),
        concurrent_clients,
        "Todas as 50 sessões devem estar ativas no SessionManager"
    );

    // Medição formal de memória RSS sob carga via /proc/self/statm
    let statm_path = "/proc/self/statm";
    if let Ok(content) = fs::read_to_string(statm_path) {
        let parts: Vec<&str> = content.split_whitespace().collect();
        if parts.len() >= 2 {
            let resident_pages: u64 = parts[1].parse().unwrap();
            let resident_mb = (resident_pages * 4096) as f64 / (1024.0 * 1024.0);

            println!("\n========================================================");
            println!("  4. ESCALABILIDADE DE MEMÓRIA SOB CARGA (50 SESSÕES)");
            println!("========================================================");
            println!(
                "  Sessões ativas concorrentes: {}",
                session_mgr.active_count()
            );
            println!("  Memória RSS sob carga ativa: {:.2} MB", resident_mb);
            println!("  Limite máximo especificado:  30.00 MB (RNF-GW-02)");
            println!("========================================================\n");

            assert!(
                resident_mb < 30.0,
                "Memória sob carga ({:.2} MB) excedeu o teto estrito de 30 MB",
                resident_mb
            );
        }
    }

    let _ = shutdown_tx.send(true);
    let _ = server_task.await;
}
