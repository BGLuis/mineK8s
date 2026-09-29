use crate::error::{ProtocolError, Result};
use crate::types::varint::VarInt;
use bytes::{Buf, BufMut};

/// Pacote de requisição Ping do cliente (Packet ID 0x01 no estado Status).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PingRequestPacket {
    pub payload: i64,
}

impl PingRequestPacket {
    pub const PACKET_ID: VarInt = VarInt(0x01);

    pub fn new(payload: i64) -> Self {
        Self { payload }
    }

    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        if buf.remaining() < 8 {
            return Err(ProtocolError::UnexpectedEof);
        }
        let payload = buf.get_i64();
        Ok(PingRequestPacket { payload })
    }

    pub fn encode(&self, buf: &mut impl BufMut) {
        buf.put_i64(self.payload);
    }
}

/// Pacote de resposta Pong do servidor (Packet ID 0x01 no estado Status).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PongResponsePacket {
    pub payload: i64,
}

impl PongResponsePacket {
    pub const PACKET_ID: VarInt = VarInt(0x01);

    pub fn new(payload: i64) -> Self {
        Self { payload }
    }

    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        if buf.remaining() < 8 {
            return Err(ProtocolError::UnexpectedEof);
        }
        let payload = buf.get_i64();
        Ok(PongResponsePacket { payload })
    }

    pub fn encode(&self, buf: &mut impl BufMut) {
        buf.put_i64(self.payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_ping_pong_roundtrip() {
        let timestamp = 1711670400000i64;
        let ping = PingRequestPacket::new(timestamp);

        let mut buf = BytesMut::new();
        ping.encode(&mut buf);

        let decoded_ping = PingRequestPacket::decode(&mut &buf[..]).unwrap();
        assert_eq!(decoded_ping.payload, timestamp);

        let pong = PongResponsePacket::new(decoded_ping.payload);
        let mut pong_buf = BytesMut::new();
        pong.encode(&mut pong_buf);

        let decoded_pong = PongResponsePacket::decode(&mut &pong_buf[..]).unwrap();
        assert_eq!(decoded_pong.payload, timestamp);
    }
}
