use bytes::{Buf, BufMut};
use regex::Regex;
use std::sync::OnceLock;

use crate::error::{ProtocolError, Result};
use crate::types::string::{decode_string, encode_string};
use crate::types::varint::VarInt;

static USERNAME_REGEX: OnceLock<Regex> = OnceLock::new();

fn username_regex() -> &'static Regex {
    USERNAME_REGEX.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9_]{2,16}$").expect("Failed to compile username regex")
    })
}

/// Valida se o nickname do jogador obedece estritamente às regras do Vanilla (RF-GW-12).
///
/// O nick deve conter entre 2 e 16 caracteres alfanuméricos ou underline (`^[a-zA-Z0-9_]{2,16}$`).
/// Nicks com espaços, caracteres de controle, escapes ANSI ou unicode especial são rejeitados.
pub fn validate_username(username: &str) -> Result<()> {
    if !username_regex().is_match(username) {
        return Err(ProtocolError::InvalidUsername(username.to_string()));
    }
    Ok(())
}

/// Pacote de início de login enviado pelo cliente (Packet ID 0x00 no estado Login).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginStartPacket {
    pub username: String,
    pub player_uuid: Option<[u8; 16]>,
}

impl LoginStartPacket {
    pub const PACKET_ID: VarInt = VarInt(0x00);

    pub fn new(username: impl Into<String>) -> Result<Self> {
        let username = username.into();
        validate_username(&username)?;
        Ok(Self {
            username,
            player_uuid: None,
        })
    }

    pub fn with_uuid(username: impl Into<String>, uuid: [u8; 16]) -> Result<Self> {
        let username = username.into();
        validate_username(&username)?;
        Ok(Self {
            username,
            player_uuid: Some(uuid),
        })
    }

    /// Decodifica o pacote Login Start e valida rigorosamente o nickname (RF-GW-12).
    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let username = decode_string(buf, 16)?;
        validate_username(&username)?;

        // Suporte opcional a UUID em versões modernas (1.19+)
        let mut player_uuid = None;
        if buf.has_remaining() {
            // Se houver indicador booleano has_uuid (1 byte)
            if buf.remaining() == 17 {
                let has_uuid = buf.get_u8() != 0;
                if has_uuid && buf.remaining() >= 16 {
                    let mut uuid_bytes = [0u8; 16];
                    buf.copy_to_slice(&mut uuid_bytes);
                    player_uuid = Some(uuid_bytes);
                }
            } else if buf.remaining() >= 16 {
                let mut uuid_bytes = [0u8; 16];
                buf.copy_to_slice(&mut uuid_bytes);
                player_uuid = Some(uuid_bytes);
            }
        }

        Ok(LoginStartPacket {
            username,
            player_uuid,
        })
    }

    /// Codifica o pacote Login Start.
    pub fn encode(&self, buf: &mut impl BufMut) {
        encode_string(&self.username, buf);
        if let Some(uuid) = self.player_uuid {
            buf.put_u8(1); // has_uuid
            buf.put_slice(&uuid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_valid_usernames() {
        assert!(validate_username("Steve").is_ok());
        assert!(validate_username("Alex").is_ok());
        assert!(validate_username("Player_123").is_ok());
        assert!(validate_username("ab").is_ok());
        assert!(validate_username("1234567890123456").is_ok()); // 16 chars
    }

    #[test]
    fn test_invalid_usernames_rejection() {
        assert!(validate_username("a").is_err(), "Too short (< 2 chars)");
        assert!(
            validate_username("toolongusername123456").is_err(),
            "Too long (> 16 chars)"
        );
        assert!(
            validate_username("Steve ").is_err(),
            "Contains trailing space"
        );
        assert!(
            validate_username("Steve\n").is_err(),
            "Contains newline control char"
        );
        assert!(
            validate_username("\x1b[31mRed").is_err(),
            "Contains ANSI escape"
        );
        assert!(
            validate_username("Player-Name").is_err(),
            "Hyphen is not permitted in Java Edition nick"
        );
        assert!(
            validate_username("Jöe").is_err(),
            "Non-ASCII characters not permitted"
        );
    }

    #[test]
    fn test_login_start_roundtrip() {
        let packet = LoginStartPacket::new("notch").unwrap();
        let mut buf = BytesMut::new();
        packet.encode(&mut buf);

        let decoded = LoginStartPacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded.username, "notch");
        assert_eq!(decoded.player_uuid, None);
    }

    #[test]
    fn test_login_start_with_uuid_roundtrip() {
        let uuid = [0x42u8; 16];
        let packet = LoginStartPacket::with_uuid("notch", uuid).unwrap();
        let mut buf = BytesMut::new();
        packet.encode(&mut buf);

        let decoded = LoginStartPacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded.username, "notch");
        assert_eq!(decoded.player_uuid, Some(uuid));
    }
}
