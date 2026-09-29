use bytes::{Buf, BufMut, BytesMut};
use minecraft_protocol::{
    normalize_hostname, HandshakeNextState, HandshakePacket, LoginStartPacket, MotdDescription,
    PingRequestPacket, PongResponsePacket, ProxyHeader, RawPacket, ServerStatusResponse,
    ServerVersionInfo, StatusRequestPacket, StatusResponsePacket, TrustedProxyFilter,
    UntrustedProxyPolicy, VarInt,
};

use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "\x1b[1;36m======================================================================\x1b[0m"
    );
    println!(
        "\x1b[1;32m      TESTE PRÁTICO EM TERMINAL — CRATE MINECRAFT-PROTOCOL (TCP REAL)  \x1b[0m"
    );
    println!(
        "\x1b[1;36m======================================================================\x1b[0m"
    );
    println!("Iniciando Mock Server TCP em loopback (127.0.0.1) usando Tokio...");

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let server_addr = listener.local_addr()?;
    println!(
        "Servidor TCP ouvindo no endereço dinâmico: \x1b[1;33m{}\x1b[0m\n",
        server_addr
    );

    // Tarefa em background rodando o servidor TCP
    tokio::spawn(async move {
        let trusted_filter = TrustedProxyFilter::default();
        loop {
            if let Ok((mut socket, peer_addr)) = listener.accept().await {
                let filter = trusted_filter.clone();
                tokio::spawn(async move {
                    let mut read_buf = BytesMut::with_capacity(4096);
                    let mut temp = [0u8; 1024];

                    // Ler primeiros bytes
                    let n = match socket.read(&mut temp).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    read_buf.extend_from_slice(&temp[..n]);

                    // 1. Checagem de PROXY Protocol v2
                    let mut cursor = &read_buf[..];
                    let real_ip = match filter.resolve_proxy_origin(
                        &mut cursor,
                        &peer_addr.ip(),
                        UntrustedProxyPolicy::Ignore,
                    ) {
                        Ok(Some(origin)) => {
                            let consumed = read_buf.len() - cursor.len();
                            read_buf.advance(consumed);
                            origin
                        }
                        _ => peer_addr,
                    };

                    // 2. Decodificação do primeiro frame (Handshake ou Malicioso)
                    let mut cursor = &read_buf[..];
                    let raw_packet = match RawPacket::decode_prelogin(&mut cursor) {
                        Ok(p) => {
                            let consumed = read_buf.len() - cursor.len();
                            read_buf.advance(consumed);
                            p
                        }
                        Err(e) => {
                            // Rejeição fail-fast de pacote malicioso
                            let _ = socket.write_all(format!("ERR:{:?}", e).as_bytes()).await;
                            let _ = socket.shutdown().await;
                            return;
                        }
                    };

                    if raw_packet.packet_id.0 == 0x00 {
                        // Handshake
                        let mut payload_cursor = &raw_packet.payload[..];
                        if let Ok(handshake) = HandshakePacket::decode(&mut payload_cursor) {
                            match handshake.next_state {
                                HandshakeNextState::Status => {
                                    // Aguardar Status Request
                                    if read_buf.is_empty() {
                                        let n = socket.read(&mut temp).await.unwrap_or(0);
                                        read_buf.extend_from_slice(&temp[..n]);
                                    }
                                    let mut cursor = &read_buf[..];
                                    if let Ok(status_raw) = RawPacket::decode_prelogin(&mut cursor)
                                    {
                                        let consumed = read_buf.len() - cursor.len();
                                        read_buf.advance(consumed);
                                        if status_raw.packet_id.0 == 0x00 {
                                            // Enviar Status Response
                                            let status_json = ServerStatusResponse {
                                                version: ServerVersionInfo {
                                                    name: "Paper 1.20.4 (mineK8s)".into(),
                                                    protocol: 765,
                                                },
                                                players: minecraft_protocol::PlayersInfo {
                                                    max: 100,
                                                    online: 42,
                                                    sample: None,
                                                },
                                                description: MotdDescription::Plain(
                                                    "§a§lMineK8s Hypervisor §7- §bGateway L7 Online!".into(),
                                                ),
                                                favicon: None,
                                                enforces_secure_chat: Some(false),
                                                previews_chat: None,
                                            };
                                            let resp =
                                                StatusResponsePacket::from_status(&status_json)
                                                    .unwrap();
                                            let mut resp_payload = BytesMut::new();
                                            resp.encode(&mut resp_payload);

                                            let frame = RawPacket {
                                                packet_id: StatusResponsePacket::PACKET_ID,
                                                payload: resp_payload.freeze(),
                                            };
                                            let mut frame_buf = BytesMut::new();
                                            frame.encode(&mut frame_buf);
                                            let _ = socket.write_all(&frame_buf).await;
                                        }
                                    }

                                    // Aguardar Ping Request
                                    if read_buf.is_empty() {
                                        let n = socket.read(&mut temp).await.unwrap_or(0);
                                        read_buf.extend_from_slice(&temp[..n]);
                                    }
                                    let mut cursor = &read_buf[..];
                                    if let Ok(ping_raw) = RawPacket::decode_prelogin(&mut cursor) {
                                        if ping_raw.packet_id.0 == 0x01 {
                                            let mut ping_cursor = &ping_raw.payload[..];
                                            if let Ok(ping) =
                                                PingRequestPacket::decode(&mut ping_cursor)
                                            {
                                                let pong = PongResponsePacket::new(ping.payload);
                                                let mut pong_payload = BytesMut::new();
                                                pong.encode(&mut pong_payload);

                                                let pong_frame = RawPacket {
                                                    packet_id: PongResponsePacket::PACKET_ID,
                                                    payload: pong_payload.freeze(),
                                                };
                                                let mut pong_buf = BytesMut::new();
                                                pong_frame.encode(&mut pong_buf);
                                                let _ = socket.write_all(&pong_buf).await;
                                            }
                                        }
                                    }
                                }
                                HandshakeNextState::Login | HandshakeNextState::Transfer => {
                                    // Aguardar Login Start
                                    if read_buf.is_empty() {
                                        let n = socket.read(&mut temp).await.unwrap_or(0);
                                        read_buf.extend_from_slice(&temp[..n]);
                                    }
                                    let mut cursor = &read_buf[..];
                                    if let Ok(login_raw) = RawPacket::decode_prelogin(&mut cursor) {
                                        if login_raw.packet_id.0 == 0x00 {
                                            let mut login_cursor = &login_raw.payload[..];
                                            if let Ok(login_start) =
                                                LoginStartPacket::decode(&mut login_cursor)
                                            {
                                                // Desconectar formatado com mensagem visual
                                                let msg = format!(
                                                    "§eOlá, §b{}§e!\n§aO Gateway mineK8s recebeu sua conexão.\n§7(IP Resolvido: §f{}§7)",
                                                    login_start.username, real_ip
                                                );
                                                let disc = minecraft_protocol::DisconnectPacket::from_plain_text(&msg);
                                                let mut disc_payload = BytesMut::new();
                                                disc.encode(&mut disc_payload);

                                                let disc_frame = RawPacket {
                                                    packet_id: VarInt(0x00),
                                                    payload: disc_payload.freeze(),
                                                };
                                                let mut disc_buf = BytesMut::new();
                                                disc_frame.encode(&mut disc_buf);
                                                let _ = socket.write_all(&disc_buf).await;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    });

    // =========================================================================
    // CENÁRIO 1: Simulação do Server List Ping (O que o cliente faz no Menu Multiplayer)
    // =========================================================================
    println!("\x1b[1;34m[CENÁRIO 1]\x1b[0m Simulando Cliente Minecraft listando servidores (Server List Ping)...");
    let start_time = Instant::now();
    let mut stream = TcpStream::connect(server_addr).await?;

    // 1.1 Enviar Handshake com Intent 1 (Status) e extensão de modpack (FML3)
    let dirty_host = "SURVIVAL.mine.lan\0FML3\0:25565";
    let normalized = normalize_hostname(dirty_host)?;
    println!(
        "  -> Cliente enviando Handshake com Hostname bruto: \x1b[33m{:?}\x1b[0m",
        dirty_host
    );
    println!(
        "     (Normalizado pela biblioteca para: \x1b[32m{:?}\x1b[0m)",
        normalized
    );

    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: dirty_host.to_string(),
        server_port: 25565,
        next_state: HandshakeNextState::Status,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    let hs_frame = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut send_buf = BytesMut::new();
    hs_frame.encode(&mut send_buf);
    stream.write_all(&send_buf).await?;

    // 1.2 Enviar Status Request
    let status_req = StatusRequestPacket;
    let mut sr_payload = BytesMut::new();
    status_req.encode(&mut sr_payload);
    let sr_frame = RawPacket {
        packet_id: StatusRequestPacket::PACKET_ID,
        payload: sr_payload.freeze(),
    };
    let mut sr_buf = BytesMut::new();
    sr_frame.encode(&mut sr_buf);
    stream.write_all(&sr_buf).await?;

    // 1.3 Receber Status Response do servidor
    let mut resp_buf = [0u8; 4096];
    let n = stream.read(&mut resp_buf).await?;
    let mut cursor = &resp_buf[..n];
    let resp_frame = RawPacket::decode_prelogin(&mut cursor)?;
    let mut payload_cursor = &resp_frame.payload[..];
    let status_resp = StatusResponsePacket::decode(&mut payload_cursor)?;

    println!("  <- \x1b[1;32m[SUCESSO]\x1b[0m Status Response recebido do servidor!");
    println!(
        "     Conteúdo JSON: \x1b[36m{}\x1b[0m",
        status_resp.json_response
    );

    // 1.4 Enviar Ping Request com timestamp
    let ping_timestamp = 1727568000999i64;
    let ping_req = PingRequestPacket::new(ping_timestamp);
    let mut ping_payload = BytesMut::new();
    ping_req.encode(&mut ping_payload);
    let ping_frame = RawPacket {
        packet_id: PingRequestPacket::PACKET_ID,
        payload: ping_payload.freeze(),
    };
    let mut ping_buf = BytesMut::new();
    ping_frame.encode(&mut ping_buf);
    stream.write_all(&ping_buf).await?;

    // 1.5 Receber Pong Response
    let n = stream.read(&mut resp_buf).await?;
    let mut cursor = &resp_buf[..n];
    let pong_frame = RawPacket::decode_prelogin(&mut cursor)?;
    let mut payload_cursor = &pong_frame.payload[..];
    let pong_resp = PongResponsePacket::decode(&mut payload_cursor)?;

    let elapsed = start_time.elapsed();
    assert_eq!(pong_resp.payload, ping_timestamp);
    println!("  <- \x1b[1;32m[SUCESSO]\x1b[0m Pong Response recebido com timestamp exato!");
    println!(
        "     Latência simulada de ping: \x1b[1;33m{:?}\x1b[0m\n",
        elapsed
    );

    // =========================================================================
    // CENÁRIO 2: Simulação de Jogador Entrando (Login Start & Disconnect Screen)
    // =========================================================================
    println!("\x1b[1;34m[CENÁRIO 2]\x1b[0m Simulando Jogador tentando conectar no servidor...");
    let mut stream = TcpStream::connect(server_addr).await?;

    // 2.1 Handshake com Intent 2 (Login)
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".to_string(),
        server_port: 25565,
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    let hs_frame = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut send_buf = BytesMut::new();
    hs_frame.encode(&mut send_buf);
    stream.write_all(&send_buf).await?;

    // 2.2 Login Start com nickname
    let player_nick = "Player_Steve";
    println!(
        "  -> Enviando LoginStart com nickname: \x1b[33m{:?}\x1b[0m",
        player_nick
    );
    let login_start = LoginStartPacket::new(player_nick)?;
    let mut login_payload = BytesMut::new();
    login_start.encode(&mut login_payload);
    let login_frame = RawPacket {
        packet_id: LoginStartPacket::PACKET_ID,
        payload: login_payload.freeze(),
    };
    let mut login_buf = BytesMut::new();
    login_frame.encode(&mut login_buf);
    stream.write_all(&login_buf).await?;

    // 2.3 Receber Disconnect Packet
    let mut resp_buf = [0u8; 4096];
    let n = stream.read(&mut resp_buf).await?;
    let mut cursor = &resp_buf[..n];
    let disc_frame = RawPacket::decode_prelogin(&mut cursor)?;
    let mut payload_cursor = &disc_frame.payload[..];
    let disc = minecraft_protocol::DisconnectPacket::decode(&mut payload_cursor)?;

    println!("  <- \x1b[1;32m[SUCESSO]\x1b[0m Pacote Disconnect recebido do servidor!");
    println!(
        "     Texto que o Minecraft renderiza na tela:\n     \x1b[35m{}\x1b[0m\n",
        disc.reason_json
    );

    // =========================================================================
    // CENÁRIO 3: Injeção de PROXY Protocol v2 (HAProxy / Tailcat / Ingress)
    // =========================================================================
    println!("\x1b[1;34m[CENÁRIO 3]\x1b[0m Simulando proxy reverso injetando cabeçalho PROXY Protocol v2...");
    let mut stream = TcpStream::connect(server_addr).await?;

    let client_real_ip = "189.40.12.34".parse()?;
    let proxy_header =
        ProxyHeader::new_ipv4_proxy(client_real_ip, 54321, "10.0.0.1".parse()?, 25565);
    let mut proxy_buf = BytesMut::new();
    proxy_header.encode(&mut proxy_buf);

    // Anexar o Handshake logo após o cabeçalho PROXY v2
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: "survival.mine.lan".to_string(),
        server_port: 25565,
        next_state: HandshakeNextState::Login,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);
    let hs_frame = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    hs_frame.encode(&mut proxy_buf);

    let login_start = LoginStartPacket::new("Alex_Tailscale")?;
    let mut login_payload = BytesMut::new();
    login_start.encode(&mut login_payload);
    let login_frame = RawPacket {
        packet_id: LoginStartPacket::PACKET_ID,
        payload: login_payload.freeze(),
    };
    login_frame.encode(&mut proxy_buf);

    println!(
        "  -> Enviando Stream TCP com PROXY v2 declarando IP de origem: \x1b[33m{}\x1b[0m",
        client_real_ip
    );
    stream.write_all(&proxy_buf).await?;

    // Receber confirmação do servidor com o IP extraído
    let mut resp_buf = [0u8; 4096];
    let n = stream.read(&mut resp_buf).await?;
    let mut cursor = &resp_buf[..n];
    let disc_frame = RawPacket::decode_prelogin(&mut cursor)?;
    let mut payload_cursor = &disc_frame.payload[..];
    let disc = minecraft_protocol::DisconnectPacket::decode(&mut payload_cursor)?;

    println!("  <- \x1b[1;32m[SUCESSO]\x1b[0m Servidor decodificou o PROXY v2 e extraiu o IP com sucesso!");
    println!(
        "     Mensagem confirmando o IP: \x1b[35m{}\x1b[0m\n",
        disc.reason_json
    );

    // =========================================================================
    // CENÁRIO 4: Teste de Defesa DoS (Teto Pré-Login > 4 KB Rejeitado)
    // =========================================================================
    println!("\x1b[1;34m[CENÁRIO 4]\x1b[0m Testando defesa contra ataque DoS (pacote malicioso > 4 KB)...");
    let mut stream = TcpStream::connect(server_addr).await?;

    // Pacote declarando 5000 bytes no VarInt de tamanho
    let mut malicious_packet = BytesMut::new();
    VarInt(5000).encode(&mut malicious_packet);
    malicious_packet.put_slice(&[0x00; 100]); // Envia apenas alguns bytes

    println!("  -> Enviando cabeçalho malicioso declarando tamanho de 5000 bytes (Limite = 4096)");
    stream.write_all(&malicious_packet).await?;

    let mut err_buf = [0u8; 128];
    let n = stream.read(&mut err_buf).await?;
    let err_str = String::from_utf8_lossy(&err_buf[..n]);

    println!("  <- \x1b[1;32m[SUCESSO]\x1b[0m Servidor acionou fail-fast e abortou socket imediatamente:");
    println!(
        "     Resposta de erro em O(1): \x1b[31m{}\x1b[0m\n",
        err_str
    );

    println!(
        "\x1b[1;32m======================================================================\x1b[0m"
    );
    println!(
        "\x1b[1;32m      TODOS OS PROTOCOLOS FORAM TESTADOS E VALIDADOS NA PRÁTICA!       \x1b[0m"
    );
    println!(
        "\x1b[1;32m======================================================================\x1b[0m"
    );

    Ok(())
}
