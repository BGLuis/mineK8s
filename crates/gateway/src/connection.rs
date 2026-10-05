use std::net::{IpAddr, SocketAddr};

use bytes::{Bytes, BytesMut};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::packets::status::StatusRequestPacket;
use minecraft_protocol::proxy_protocol::header::ProxyHeader;
use minecraft_protocol::types::varint::VarInt;
use minecraft_protocol::ProtocolError;

use crate::config::GatewayConfig;
use crate::error::{GatewayError, Result};
use crate::limiter::ConnectionRateLimiter;

/// Resultado da fase inicial de handshake e pré-login.
#[derive(Debug)]
pub enum HandshakeResult {
    Status {
        handshake: HandshakePacket,
        request: StatusRequestPacket,
        client_ip: IpAddr,
    },
    Login {
        handshake: HandshakePacket,
        login_start: LoginStartPacket,
        original_handshake: Bytes,
        original_login_start: Bytes,
        client_ip: IpAddr,
    },
}

/// Gerencia o ciclo de vida e buffer de uma conexão de cliente TCP.
pub struct ClientConnection {
    pub stream: TcpStream,
    pub peer_addr: SocketAddr,
    pub client_ip: IpAddr,
    pub buffer: BytesMut,
}

impl ClientConnection {
    pub fn new(stream: TcpStream, peer_addr: SocketAddr) -> Self {
        Self {
            stream,
            peer_addr,
            client_ip: peer_addr.ip(),
            buffer: BytesMut::with_capacity(4096),
        }
    }

    /// Executa o handshake inicial com proteção contra Slowloris (timeout estrito de 5s, RF-GW-04),
    /// rate limiting (RF-GW-14) e tolerância a fragmentação TCP (RF-GW-03).
    pub async fn process_initial_handshake(
        &mut self,
        config: &GatewayConfig,
        rate_limiter: &ConnectionRateLimiter,
    ) -> Result<HandshakeResult> {
        // 1. Rate limiting por IP de conexão física (RF-GW-14)
        if !rate_limiter.check(self.peer_addr.ip()) {
            return Err(GatewayError::RateLimited(self.peer_addr.ip()));
        }

        // 2. Timeout estrito de 5.0 segundos para a conclusão de Handshake + Status/Login (RF-GW-04)
        let timeout_duration = config.handshake_timeout;
        match tokio::time::timeout(
            timeout_duration,
            self.read_handshake_and_next_packet(config),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(GatewayError::HandshakeTimeout),
        }
    }

    /// Loop de leitura streaming com tolerância a fragmentação TCP e decodificação de pacotes.
    async fn read_handshake_and_next_packet(
        &mut self,
        config: &GatewayConfig,
    ) -> Result<HandshakeResult> {
        // 1. Inspecionar opcionalmente cabeçalho PROXY Protocol v2
        self.detect_proxy_v2(config).await?;

        // 2. Ler pacote Handshake (Packet ID 0x00)
        let (raw_handshake, handshake_bytes) = self.read_raw_packet_streaming().await?;
        if raw_handshake.packet_id != VarInt(0x00) {
            return Err(GatewayError::InvalidState(format!(
                "Esperado pacote Handshake (0x00), recebido: 0x{:02X}",
                raw_handshake.packet_id.0
            )));
        }

        let mut payload_cursor = &raw_handshake.payload[..];
        let handshake = HandshakePacket::decode(&mut payload_cursor)?;

        // 3. Ler próximo pacote conforme next_state
        match handshake.next_state {
            HandshakeNextState::Status => {
                let (raw_status, _) = self.read_raw_packet_streaming().await?;
                if raw_status.packet_id != StatusRequestPacket::PACKET_ID {
                    return Err(GatewayError::InvalidState(format!(
                        "Esperado pacote Status Request (0x00), recebido: 0x{:02X}",
                        raw_status.packet_id.0
                    )));
                }

                let mut status_cursor = &raw_status.payload[..];
                let request = StatusRequestPacket::decode(&mut status_cursor)?;

                Ok(HandshakeResult::Status {
                    handshake,
                    request,
                    client_ip: self.client_ip,
                })
            }
            state if state.is_login_like() => {
                let (raw_login, login_bytes) = self.read_raw_packet_streaming().await?;
                if raw_login.packet_id != LoginStartPacket::PACKET_ID {
                    return Err(GatewayError::InvalidState(format!(
                        "Esperado pacote Login Start (0x00), recebido: 0x{:02X}",
                        raw_login.packet_id.0
                    )));
                }

                let mut login_cursor = &raw_login.payload[..];
                let login_start = LoginStartPacket::decode(&mut login_cursor)?;

                Ok(HandshakeResult::Login {
                    handshake,
                    login_start,
                    original_handshake: handshake_bytes,
                    original_login_start: login_bytes,
                    client_ip: self.client_ip,
                })
            }
            other => Err(GatewayError::InvalidState(format!(
                "NextState inválido ou não suportado: {:?}",
                other
            ))),
        }
    }

    /// Lê continuamente da stream TCP para o buffer até conseguir decodificar um RawPacket completo.
    /// Resiliente a fragmentação TCP (RF-GW-03) e limites estritos de 4 KB (RF-GW-04).
    pub async fn read_raw_packet_streaming(&mut self) -> Result<(RawPacket, Bytes)> {
        loop {
            // Tenta decodificar a partir do buffer atual sem consumir antes de saber se está completo
            let initial_len = self.buffer.len();
            if initial_len > 0 {
                let mut cursor = &self.buffer[..];
                match RawPacket::decode_prelogin(&mut cursor) {
                    Ok(packet) => {
                        let consumed = initial_len - cursor.len();
                        let packet_bytes = self.buffer.split_to(consumed).freeze();
                        return Ok((packet, packet_bytes));
                    }
                    Err(ProtocolError::UnexpectedEof) => {
                        // Precisa de mais bytes vindos do socket TCP
                    }
                    Err(err) => return Err(GatewayError::Protocol(err)),
                }
            }

            // Ler mais bytes da stream
            let n = self.stream.read_buf(&mut self.buffer).await?;
            if n == 0 {
                return Err(GatewayError::ConnectionClosed);
            }
        }
    }

    /// Detecta e consome cabeçalho PROXY Protocol v2 se presente na conexão.
    async fn detect_proxy_v2(&mut self, config: &GatewayConfig) -> Result<()> {
        loop {
            let mut cursor = &self.buffer[..];
            match ProxyHeader::parse(&mut cursor) {
                Ok(Some(header)) => {
                    let consumed = self.buffer.len() - cursor.len();
                    let _ = self.buffer.split_to(consumed);

                    // Validar se o IP do peer é confiável para aceitar PROXY v2 (RF-GW-08)
                    if config.trusted_proxies.is_trusted(&self.peer_addr.ip()) {
                        if let Some(src_sock) = header.address.src_socket_addr() {
                            self.client_ip = src_sock.ip();
                        }
                    } else {
                        // Se não for confiável, rejeitar conexão para evitar spoofing
                        return Err(GatewayError::Protocol(ProtocolError::UntrustedProxy(
                            self.peer_addr.ip(),
                        )));
                    }
                    return Ok(());
                }
                Ok(None) => {
                    // Conexão TCP direta nativa (sem cabeçalho PROXY)
                    return Ok(());
                }
                Err(ProtocolError::UnexpectedEof) => {
                    // Preâmbulo PROXY começou mas ainda faltam bytes no buffer
                    let n = self.stream.read_buf(&mut self.buffer).await?;
                    if n == 0 {
                        return Err(GatewayError::ConnectionClosed);
                    }
                }
                Err(err) => return Err(GatewayError::Protocol(err)),
            }
        }
    }
}
