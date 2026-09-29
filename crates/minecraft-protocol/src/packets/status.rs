use bytes::{Buf, BufMut};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::types::string::{decode_string, encode_string};
use crate::types::varint::VarInt;

/// Informações de versão para o Status Response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerVersionInfo {
    pub name: String,
    pub protocol: i32,
}

/// Amostra de jogador na lista de jogadores online.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerSample {
    pub name: String,
    pub id: String,
}

/// Informações sobre jogadores online.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayersInfo {
    pub max: i32,
    pub online: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<Vec<PlayerSample>>,
}

/// Texto ou componente de descrição (MOTD).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MotdDescription {
    Plain(String),
    Structured(serde_json::Value),
}

/// Estrutura canônica do JSON de resposta do Server List Ping (Status Response).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerStatusResponse {
    pub version: ServerVersionInfo,
    pub players: PlayersInfo,
    pub description: MotdDescription,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "enforcesSecureChat")]
    pub enforces_secure_chat: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "previewsChat")]
    pub previews_chat: Option<bool>,
}

/// Pacote de requisição de status enviado pelo cliente (Packet ID 0x00 no estado Status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StatusRequestPacket;

impl StatusRequestPacket {
    pub const PACKET_ID: VarInt = VarInt(0x00);

    pub fn decode(_buf: &mut impl Buf) -> Result<Self> {
        Ok(StatusRequestPacket)
    }

    pub fn encode(&self, _buf: &mut impl BufMut) {
        // Payload vazio
    }
}

/// Pacote de resposta de status enviado pelo servidor (Packet ID 0x00 no estado Status).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusResponsePacket {
    pub json_response: String,
}

impl StatusResponsePacket {
    pub const PACKET_ID: VarInt = VarInt(0x00);

    pub fn new(json_response: impl Into<String>) -> Self {
        Self {
            json_response: json_response.into(),
        }
    }

    pub fn from_status(status: &ServerStatusResponse) -> Result<Self> {
        let json = serde_json::to_string(status)
            .map_err(|e| crate::error::ProtocolError::InvalidData(e.to_string()))?;
        Ok(Self::new(json))
    }

    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let json_response = decode_string(buf, 32767)?;
        Ok(StatusResponsePacket { json_response })
    }

    pub fn encode(&self, buf: &mut impl BufMut) {
        encode_string(&self.json_response, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_status_request_roundtrip() {
        let req = StatusRequestPacket;
        let mut buf = BytesMut::new();
        req.encode(&mut buf);
        let decoded = StatusRequestPacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded, req);
    }

    #[test]
    fn test_status_response_roundtrip() {
        let status = ServerStatusResponse {
            version: ServerVersionInfo {
                name: "Paper 1.20.4".to_string(),
                protocol: 765,
            },
            players: PlayersInfo {
                max: 20,
                online: 5,
                sample: None,
            },
            description: MotdDescription::Plain("A Minecraft Server".to_string()),
            favicon: None,
            enforces_secure_chat: Some(false),
            previews_chat: None,
        };

        let resp = StatusResponsePacket::from_status(&status).unwrap();
        let mut buf = BytesMut::new();
        resp.encode(&mut buf);

        let decoded = StatusResponsePacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded, resp);
    }
}
