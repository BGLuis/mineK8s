use std::time::Duration;

use bytes::{BufMut, BytesMut};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::sleep;

use gateway::{ClientConnection, GatewayConfig, GatewayError, HandshakeResult};
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::proxy_protocol::header::ProxyHeader;
use minecraft_protocol::types::varint::VarInt;

/// Testa a tolerância à fragmentação TCP (RF-GW-03, RF-GW-19).
/// Envia o pacote de Handshake e Status Request fatiados em blocos de 1 byte com pequenas pausas assíncronas.
#[tokio::test]
async fn test_tcp_fragmentation_tolerance() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server_task = tokio::spawn(async move {
        let (stream, peer_addr) = listener.accept().await.unwrap();
        let mut conn = ClientConnection::new(stream, peer_addr);
        let config = GatewayConfig::default();
        let limiter = gateway::ConnectionRateLimiter::default();
        conn.process_initial_handshake(&config, &limiter).await
    });

    let client_task = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();

        // 1. Montar pacote de Handshake
        let mut handshake_payload = BytesMut::new();
        let handshake = HandshakePacket {
            protocol_version: VarInt(765),
            server_address: "survival.mine.lan".to_string(),
            server_port: 25565,
            next_state: HandshakeNextState::Status,
        };
        handshake.encode(&mut handshake_payload);

        let mut handshake_wire = BytesMut::new();
        VarInt(handshake_payload.len() as i32 + 1).encode(&mut handshake_wire); // total len
        VarInt(0x00).encode(&mut handshake_wire); // packet id
        handshake_wire.put_slice(&handshake_payload);

        // 2. Montar pacote de Status Request
        let mut status_wire = BytesMut::new();
        VarInt(1).encode(&mut status_wire); // total len: 1
        VarInt(0x00).encode(&mut status_wire); // packet id: 0x00

        // Enviar os bytes do Handshake de 1 em 1 byte com delay
        for byte in handshake_wire {
            stream.write_all(&[byte]).await.unwrap();
            sleep(Duration::from_millis(5)).await;
        }

        // Enviar os bytes do Status Request de 1 em 1 byte com delay
        for byte in status_wire {
            stream.write_all(&[byte]).await.unwrap();
            sleep(Duration::from_millis(5)).await;
        }
    });

    client_task.await.unwrap();
    let res = server_task.await.unwrap();
    assert!(
        res.is_ok(),
        "Falha ao processar handshake fragmentado: {:?}",
        res.err()
    );

    match res.unwrap() {
        HandshakeResult::Status {
            handshake,
            request: _,
            client_ip,
        } => {
            assert_eq!(handshake.server_address, "survival.mine.lan");
            assert_eq!(handshake.server_port, 25565);
            assert_eq!(handshake.next_state, HandshakeNextState::Status);
            assert_eq!(client_ip, addr.ip());
        }
        other => panic!("Esperado HandshakeResult::Status, recebido: {:?}", other),
    }
}

/// Testa proteção contra Slowloris: conexão que não conclui o handshake em 5 segundos é sumariamente derrubada (RF-GW-04).
#[tokio::test]
async fn test_slowloris_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server_task = tokio::spawn(async move {
        let (stream, peer_addr) = listener.accept().await.unwrap();
        let mut conn = ClientConnection::new(stream, peer_addr);
        let mut config = GatewayConfig::default();
        // Para o teste unitário rodar rápido sem esperar 5s reais, usamos 200ms
        config.handshake_timeout = Duration::from_millis(200);
        let limiter = gateway::ConnectionRateLimiter::default();
        conn.process_initial_handshake(&config, &limiter).await
    });

    let client_task = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        // Envia apenas 1 byte e não conclui o pacote
        stream.write_all(&[0x05]).await.unwrap();
        sleep(Duration::from_millis(350)).await;

        // Tentar ler da stream: o servidor deve ter fechado o socket
        let mut buf = [0u8; 16];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        assert_eq!(
            n, 0,
            "Socket deveria ter sido fechado pelo servidor após timeout"
        );
    });

    client_task.await.unwrap();
    let res = server_task.await.unwrap();
    assert!(matches!(res, Err(GatewayError::HandshakeTimeout)));
}

/// Testa o rate limiter de conexões token bucket do governor (RF-GW-14).
#[tokio::test]
async fn test_rate_limiter_governor() {
    let limiter = gateway::ConnectionRateLimiter::new(2);
    let ip: std::net::IpAddr = "10.0.0.1".parse().unwrap();

    assert!(limiter.check(ip), "Primeira requisição deve ser permitida");
    assert!(limiter.check(ip), "Segunda requisição deve ser permitida");
    assert!(
        !limiter.check(ip),
        "Terceira requisição imediata deve ser bloqueada por rate limit"
    );
}

/// Testa rejeição imediata de pacote pré-login superior a 4 KB sem alocação no heap (RF-GW-04).
#[tokio::test]
async fn test_packet_over_4kb_rejection() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server_task = tokio::spawn(async move {
        let (stream, peer_addr) = listener.accept().await.unwrap();
        let mut conn = ClientConnection::new(stream, peer_addr);
        let config = GatewayConfig::default();
        let limiter = gateway::ConnectionRateLimiter::default();
        conn.process_initial_handshake(&config, &limiter).await
    });

    let client_task = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        let mut bomb = BytesMut::new();
        // Declara tamanho 4097 (> 4096)
        VarInt(4097).encode(&mut bomb);
        VarInt(0x00).encode(&mut bomb);
        stream.write_all(&bomb).await.unwrap();
    });

    client_task.await.unwrap();
    let res = server_task.await.unwrap();
    assert!(res.is_err());
    match res.unwrap_err() {
        GatewayError::Protocol(minecraft_protocol::ProtocolError::PacketTooLarge {
            size,
            max_size,
        }) => {
            assert_eq!(size, 4097);
            assert_eq!(max_size, 4096);
        }
        other => panic!("Esperado PacketTooLarge, recebido: {:?}", other),
    }
}

/// Testa a extração de IP real via PROXY Protocol v2 com IP confiável (RF-GW-08).
#[tokio::test]
async fn test_trusted_proxy_v2_handshake() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server_task = tokio::spawn(async move {
        let (stream, peer_addr) = listener.accept().await.unwrap();
        let mut conn = ClientConnection::new(stream, peer_addr);
        let config = GatewayConfig::default();
        // 127.0.0.1 é confiável por padrão
        let limiter = gateway::ConnectionRateLimiter::default();
        conn.process_initial_handshake(&config, &limiter).await
    });

    let client_task = tokio::spawn(async move {
        let mut stream = TcpStream::connect(addr).await.unwrap();

        // 1. Cabeçalho PROXY v2 declarando IP real 100.64.0.42
        let real_client_ip: std::net::Ipv4Addr = "100.64.0.42".parse().unwrap();
        let proxy_header =
            ProxyHeader::new_ipv4_proxy(real_client_ip, 54321, "127.0.0.1".parse().unwrap(), 25565);
        let mut wire = BytesMut::new();
        proxy_header.encode(&mut wire);

        // 2. Handshake Login
        let handshake = HandshakePacket {
            protocol_version: VarInt(765),
            server_address: "survival.mine.lan".to_string(),
            server_port: 25565,
            next_state: HandshakeNextState::Login,
        };
        let mut hs_payload = BytesMut::new();
        handshake.encode(&mut hs_payload);

        VarInt(hs_payload.len() as i32 + 1).encode(&mut wire);
        VarInt(0x00).encode(&mut wire);
        wire.put_slice(&hs_payload);

        // 3. Login Start
        let login = LoginStartPacket::new("PlayerTest").unwrap();
        let mut login_payload = BytesMut::new();
        login.encode(&mut login_payload);

        VarInt(login_payload.len() as i32 + 1).encode(&mut wire);
        VarInt(0x00).encode(&mut wire);
        wire.put_slice(&login_payload);

        stream.write_all(&wire).await.unwrap();
    });

    client_task.await.unwrap();
    let res = server_task.await.unwrap();
    assert!(res.is_ok(), "Erro no handshake: {:?}", res.err());

    match res.unwrap() {
        HandshakeResult::Login {
            handshake,
            login_start,
            client_ip,
            ..
        } => {
            assert_eq!(handshake.server_address, "survival.mine.lan");
            assert_eq!(login_start.username, "PlayerTest");
            assert_eq!(
                client_ip,
                "100.64.0.42".parse::<std::net::IpAddr>().unwrap()
            );
        }
        other => panic!("Esperado HandshakeResult::Login, recebido: {:?}", other),
    }
}
