use std::time::Duration;
use bytes::BytesMut;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tracing::debug;

use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::ping::{PingRequestPacket, PongResponsePacket};
use minecraft_protocol::packets::status::{StatusRequestPacket, StatusResponsePacket};
use minecraft_protocol::types::varint::VarInt;

use crate::connection::ClientConnection;
use crate::error::{GatewayError, Result};
use crate::motd::cache::StatusCache;
use crate::motd::synthetic::build_synthetic_status;
use crate::routing::{CachedServerRoute, ServerInstanceStatus};

/// Trata a sequência completa do Server List Ping (Status Request -> Status Response -> Ping Request -> Pong Response).
pub async fn handle_status_ping(
    mut conn: ClientConnection,
    route: Option<CachedServerRoute>,
    status_cache: &StatusCache,
) -> Result<()> {
    // 1. Obter o JSON de resposta (em cache, sintetizado pelo Gateway ou consultado na JVM upstream)
    let json_response = resolve_status_json(&route, status_cache).await;

    // 2. Enviar Status Response (Packet ID 0x00)
    let status_pkt = StatusResponsePacket::new(json_response);
    let mut status_payload = BytesMut::new();
    status_pkt.encode(&mut status_payload);

    let raw_status_response = RawPacket {
        packet_id: StatusResponsePacket::PACKET_ID,
        payload: status_payload.freeze(),
    };
    let mut wire_buf = BytesMut::new();
    raw_status_response.encode(&mut wire_buf);
    conn.stream.write_all(&wire_buf).await?;

    // 3. Aguardar pacote Ping Request (Packet ID 0x01) com timeout de 3s
    let ping_read_res = timeout(Duration::from_secs(3), conn.read_raw_packet_streaming()).await;
    match ping_read_res {
        Ok(Ok((raw_ping, _))) => {
            if raw_ping.packet_id == PingRequestPacket::PACKET_ID {
                let mut payload_cursor = &raw_ping.payload[..];
                let ping = PingRequestPacket::decode(&mut payload_cursor)?;

                // 4. Enviar Pong Response (Packet ID 0x01) espelhando o timestamp
                let pong = PongResponsePacket::new(ping.payload);
                let mut pong_payload = BytesMut::new();
                pong.encode(&mut pong_payload);

                let raw_pong = RawPacket {
                    packet_id: PongResponsePacket::PACKET_ID,
                    payload: pong_payload.freeze(),
                };
                let mut pong_wire = BytesMut::new();
                raw_pong.encode(&mut pong_wire);
                conn.stream.write_all(&pong_wire).await?;
            } else {
                debug!(id = raw_ping.packet_id.0, "Pacote inesperado aguardando Ping Request");
            }
        }
        _ => {
            // Cliente fechou ou não enviou ping (comum em scanners rápidos)
        }
    }

    // 5. Graceful socket shutdown
    let _ = conn.stream.shutdown().await;
    Ok(())
}

/// Resolve a string JSON do Status:
/// - Se servidor Stopped, Starting ou Maintenance: retorna MOTD sintético SEM tocar a JVM (Zero Upstream I/O).
/// - Se servidor Ready: consulta cache (TTL 3s) e se expirado consulta a JVM interna.
async fn resolve_status_json(
    route: &Option<CachedServerRoute>,
    status_cache: &StatusCache,
) -> String {
    match route {
        Some(r) if r.status == ServerInstanceStatus::Ready => {
            if let Some(cached) = status_cache.get(&r.server_id) {
                return cached;
            }

            // Tentar consultar JVM upstream com timeout curto (2 segundos)
            if let Some(target) = r.target_addr {
                if let Ok(Ok(upstream_json)) = timeout(Duration::from_secs(2), query_upstream_status(target, &r.subdomain)).await {
                    status_cache.set(&r.server_id, upstream_json.clone());
                    return upstream_json;
                }
            }

            // Fallback sintético se a JVM não responder a tempo
            let synthetic = build_synthetic_status(Some(r));
            serde_json::to_string(&synthetic).unwrap_or_default()
        }
        other => {
            let synthetic = build_synthetic_status(other.as_ref());
            serde_json::to_string(&synthetic).unwrap_or_default()
        }
    }
}

/// Dispara consulta de Status ping para uma instância backend JVM interna.
async fn query_upstream_status(target: std::net::SocketAddr, hostname: &str) -> Result<String> {
    let mut upstream = TcpStream::connect(target).await?;

    // 1. Enviar Handshake (NextState = Status)
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: hostname.to_string(),
        server_port: target.port(),
        next_state: HandshakeNextState::Status,
    };
    let mut hs_payload = BytesMut::new();
    handshake.encode(&mut hs_payload);

    let raw_hs = RawPacket {
        packet_id: HandshakePacket::PACKET_ID,
        payload: hs_payload.freeze(),
    };
    let mut wire = BytesMut::new();
    raw_hs.encode(&mut wire);

    // 2. Enviar Status Request (0x00)
    let raw_req = RawPacket {
        packet_id: StatusRequestPacket::PACKET_ID,
        payload: bytes::Bytes::new(),
    };
    raw_req.encode(&mut wire);
    upstream.write_all(&wire).await?;

    // 3. Ler Status Response
    let mut conn = ClientConnection::new(upstream, target);
    let (raw_res, _) = conn.read_raw_packet_streaming().await?;
    if raw_res.packet_id != StatusResponsePacket::PACKET_ID {
        return Err(GatewayError::InvalidState("Esperado StatusResponse do upstream".into()));
    }

    let mut cursor = &raw_res.payload[..];
    let res = StatusResponsePacket::decode(&mut cursor)?;
    Ok(res.json_response)
}
