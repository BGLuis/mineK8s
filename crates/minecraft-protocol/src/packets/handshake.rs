use bytes::{Buf, BufMut};
use regex::Regex;
use std::sync::OnceLock;

use crate::error::{ProtocolError, Result};
use crate::types::string::{decode_string, encode_string};
use crate::types::varint::VarInt;

static HOSTNAME_REGEX: OnceLock<Regex> = OnceLock::new();

fn hostname_regex() -> &'static Regex {
    HOSTNAME_REGEX.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9.-]{1,255}$").expect("Failed to compile hostname regex")
    })
}

/// Estado subsequente solicitado pelo Handshake do Minecraft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HandshakeNextState {
    /// Consulta da lista de servidores / MOTD e Ping (1)
    Status,
    /// Conexão direta de jogo / autenticação (2)
    Login,
    /// Transferência entre instâncias (3) — Minecraft 1.20.5+ (E-06)
    Transfer,
}

impl HandshakeNextState {
    pub fn from_varint(varint: VarInt) -> Result<Self> {
        match varint.0 {
            1 => Ok(HandshakeNextState::Status),
            2 => Ok(HandshakeNextState::Login),
            3 => Ok(HandshakeNextState::Transfer),
            other => Err(ProtocolError::InvalidNextState(other)),
        }
    }

    pub fn to_varint(self) -> VarInt {
        match self {
            HandshakeNextState::Status => VarInt(1),
            HandshakeNextState::Login => VarInt(2),
            HandshakeNextState::Transfer => VarInt(3),
        }
    }

    /// Retorna `true` se o estado for tratado como fluxo de Login (Login ou Transfer — E-06).
    pub fn is_login_like(&self) -> bool {
        matches!(
            self,
            HandshakeNextState::Login | HandshakeNextState::Transfer
        )
    }
}

/// Normaliza e sanitiza o hostname do servidor extraído do Handshake (RF-GW-05).
///
/// 1. Trunca no primeiro caractere nulo (`\0`) caso dados proprietários (Forge, FML3) estejam anexados.
/// 2. Remove porta explícita anexada no formato `:porta` (ex.: `:25565`).
/// 3. Remove ponto final residual (`.`).
/// 4. Converte para minúsculas (`to_ascii_lowercase`).
/// 5. Valida via expressão regular: `^[a-zA-Z0-9.-]{1,255}$`.
pub fn normalize_hostname(raw: &str) -> Result<String> {
    // 1. Localizar primeiro \0 e truncar
    let truncated = match raw.find('\0') {
        Some(idx) => &raw[..idx],
        None => raw,
    };

    // 2. Remover qualquer porta anexa no formato :porta no final da string
    let without_port = if let Some(colon_idx) = truncated.rfind(':') {
        let after_colon = &truncated[colon_idx + 1..];
        if !after_colon.is_empty() && after_colon.chars().all(|c| c.is_ascii_digit()) {
            &truncated[..colon_idx]
        } else {
            truncated
        }
    } else {
        truncated
    };

    // 3. Remover ponto final residual
    let trimmed = without_port.strip_suffix('.').unwrap_or(without_port);

    // 4. Converter para minúsculas
    let normalized = trimmed.to_ascii_lowercase();

    // 5. Validar com regex ^[a-zA-Z0-9.-]{1,255}$
    if normalized.is_empty() || !hostname_regex().is_match(&normalized) {
        return Err(ProtocolError::InvalidHostname(raw.to_string()));
    }

    Ok(normalized)
}

/// Pacote de Handshake inicial do Minecraft (Packet ID 0x00).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandshakePacket {
    pub protocol_version: VarInt,
    pub server_address: String,
    pub server_port: u16,
    pub next_state: HandshakeNextState,
}

impl HandshakePacket {
    pub const PACKET_ID: VarInt = VarInt(0x00);

    /// Decodifica o pacote a partir do payload de um frame de Handshake.
    ///
    /// O `server_address` é normalizado de acordo com o algoritmo RF-GW-05.
    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let protocol_version = VarInt::decode(buf)?;
        let raw_address = decode_string(buf, 255)?;
        if !buf.has_remaining() || buf.remaining() < 2 {
            return Err(ProtocolError::UnexpectedEof);
        }
        let server_port = buf.get_u16();
        let next_state_varint = VarInt::decode(buf)?;
        let next_state = HandshakeNextState::from_varint(next_state_varint)?;

        let server_address = normalize_hostname(&raw_address)?;

        Ok(HandshakePacket {
            protocol_version,
            server_address,
            server_port,
            next_state,
        })
    }

    /// Codifica o pacote Handshake no buffer de saída.
    pub fn encode(&self, buf: &mut impl BufMut) {
        self.protocol_version.encode(buf);
        encode_string(&self.server_address, buf);
        buf.put_u16(self.server_port);
        self.next_state.to_varint().encode(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_hostname_normalization_matrix() {
        // Caso de teste mandatório da issue e RFC
        assert_eq!(
            normalize_hostname("SURVIVAL.mine.lan\0FML3\0:25565").unwrap(),
            "survival.mine.lan"
        );

        // Hostname com porta padrão
        assert_eq!(
            normalize_hostname("SURVIVAL.mine.lan:25565").unwrap(),
            "survival.mine.lan"
        );

        // Hostname com ponto final FQDN
        assert_eq!(
            normalize_hostname("SURVIVAL.mine.lan.").unwrap(),
            "survival.mine.lan"
        );

        // Hostname com ponto final e porta
        assert_eq!(
            normalize_hostname("SURVIVAL.mine.lan.:25565").unwrap(),
            "survival.mine.lan"
        );

        // Hostname com maiúsculas
        assert_eq!(
            normalize_hostname("LOBBY.MC.EXAMPLE.COM").unwrap(),
            "lobby.mc.example.com"
        );

        // Hostname inválido com caracteres proibidos
        assert!(normalize_hostname("bad hostname$!").is_err());
        assert!(normalize_hostname("").is_err());
    }

    #[test]
    fn test_handshake_intent_3_transfer() {
        let state = HandshakeNextState::from_varint(VarInt(3)).unwrap();
        assert_eq!(state, HandshakeNextState::Transfer);
        assert!(state.is_login_like());
    }

    #[test]
    fn test_handshake_roundtrip() {
        let packet = HandshakePacket {
            protocol_version: VarInt(765),
            server_address: "survival.mine.lan".to_string(),
            server_port: 25565,
            next_state: HandshakeNextState::Login,
        };

        let mut buf = BytesMut::new();
        packet.encode(&mut buf);

        let mut cursor = &buf[..];
        let decoded = HandshakePacket::decode(&mut cursor).expect("Decode Handshake");
        assert_eq!(decoded, packet);
        assert_eq!(cursor.len(), 0);
    }
}
