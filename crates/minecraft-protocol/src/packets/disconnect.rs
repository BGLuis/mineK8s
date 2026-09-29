use crate::error::Result;
use crate::types::string::{decode_string, encode_string};
use crate::types::varint::VarInt;
use bytes::{Buf, BufMut};

/// Pacote de desconexão (Disconnect) enviado pelo servidor nos estados de Login ou Play.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisconnectPacket {
    /// Representação em JSON do componente de texto / chat do Minecraft
    pub reason_json: String,
}

impl DisconnectPacket {
    /// Packet ID de Disconnect na fase de Login (0x00).
    pub const LOGIN_PACKET_ID: VarInt = VarInt(0x00);

    /// Packet ID padrão de Disconnect na fase de Play em versões modernas (0x1A / 0x1B).
    pub const PLAY_PACKET_ID: VarInt = VarInt(0x1A);

    /// Cria uma mensagem de desconexão a partir de um texto puro com formatação de cor (§).
    pub fn from_plain_text(message: &str) -> Self {
        let escaped = serde_json::to_string(message).unwrap_or_else(|_| format!("\"{}\"", message));
        Self {
            reason_json: format!("{{\"text\":{}}}", escaped),
        }
    }

    /// Cria uma mensagem de desconexão a partir de um JSON bruto do Chat Component.
    pub fn from_json(json: impl Into<String>) -> Self {
        Self {
            reason_json: json.into(),
        }
    }

    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let reason_json = decode_string(buf, 32767)?;
        Ok(DisconnectPacket { reason_json })
    }

    pub fn encode(&self, buf: &mut impl BufMut) {
        encode_string(&self.reason_json, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_disconnect_plain_text_roundtrip() {
        let msg = "§cServidor em manutenção ou dormindo.";
        let packet = DisconnectPacket::from_plain_text(msg);

        let mut buf = BytesMut::new();
        packet.encode(&mut buf);

        let decoded = DisconnectPacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded.reason_json, format!("{{\"text\":{:?}}}", msg));
    }
}
