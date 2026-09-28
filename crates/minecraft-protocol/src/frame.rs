use crate::constants::MAX_PRELOGIN_PACKET_SIZE;
use crate::error::{ProtocolError, Result};
use crate::types::varint::VarInt;
use bytes::{Buf, BufMut, Bytes};

/// Representa um frame de pacote bruto decodificado com seu ID e payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPacket {
    pub packet_id: VarInt,
    pub payload: Bytes,
}

impl RawPacket {
    /// Decodifica um frame na fase pré-login com validação do limite estrito de 4 KB (RF-GW-04).
    ///
    /// Se o pacote declarar tamanho > 4096 bytes, retorna `ProtocolError::PacketTooLarge`
    /// imediatamente, sem alocar memória no heap para o corpo do pacote.
    pub fn decode_prelogin(buf: &mut impl Buf) -> Result<Self> {
        let packet_len = read_prelogin_packet_length(buf)?;

        if buf.remaining() < packet_len {
            return Err(ProtocolError::UnexpectedEof);
        }

        // Medir quantos bytes foram consumidos para ler o packet_id
        let initial_remaining = buf.remaining();
        let packet_id = VarInt::decode(buf)?;
        let id_len = initial_remaining - buf.remaining();

        if id_len > packet_len {
            return Err(ProtocolError::InvalidData(
                "Packet ID length exceeds total packet length".into(),
            ));
        }

        let payload_len = packet_len - id_len;
        let payload = buf.copy_to_bytes(payload_len);

        Ok(RawPacket { packet_id, payload })
    }

    /// Codifica o pacote bruto serializando `[packet_length (VarInt)][packet_id (VarInt)][payload]`.
    pub fn encode(&self, buf: &mut impl BufMut) {
        let id_len = self.packet_id.encoded_len();
        let total_len = id_len + self.payload.len();
        VarInt(total_len as i32).encode(buf);
        self.packet_id.encode(buf);
        buf.put_slice(&self.payload);
    }
}

/// Lê e valida o tamanho de um frame pré-login.
///
/// Lança erro `PacketTooLarge` se o tamanho for superior a `MAX_PRELOGIN_PACKET_SIZE` (4 KB).
pub fn read_prelogin_packet_length(buf: &mut impl Buf) -> Result<usize> {
    let packet_len = VarInt::decode(buf)?.0;
    if packet_len <= 0 {
        return Err(ProtocolError::InvalidData(
            "Packet length must be positive".into(),
        ));
    }
    let packet_len = packet_len as usize;
    if packet_len > MAX_PRELOGIN_PACKET_SIZE {
        return Err(ProtocolError::PacketTooLarge {
            size: packet_len,
            max_size: MAX_PRELOGIN_PACKET_SIZE,
        });
    }
    Ok(packet_len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_prelogin_packet_within_limit() {
        let mut buf = BytesMut::new();
        let payload_data = b"hello";
        let raw = RawPacket {
            packet_id: VarInt(0x00),
            payload: Bytes::from_static(payload_data),
        };
        raw.encode(&mut buf);

        let mut cursor = &buf[..];
        let decoded = RawPacket::decode_prelogin(&mut cursor).expect("Decode prelogin packet");
        assert_eq!(decoded.packet_id, VarInt(0x00));
        assert_eq!(&decoded.payload[..], payload_data);
    }

    #[test]
    fn test_prelogin_packet_over_4kb_rejection() {
        // Simula um pacote que declara 4097 bytes (> 4 KB)
        let mut buf = BytesMut::new();
        VarInt(4097).encode(&mut buf);
        // Não alocamos 4097 bytes para o teste: a rejeição deve ocorrer no cabeçalho
        let mut cursor = &buf[..];
        let result = read_prelogin_packet_length(&mut cursor);
        assert_eq!(
            result,
            Err(ProtocolError::PacketTooLarge {
                size: 4097,
                max_size: 4096,
            })
        );
    }

    #[test]
    fn test_prelogin_packet_exact_4kb_accepted() {
        let mut buf = BytesMut::new();
        VarInt(4096).encode(&mut buf);
        let mut cursor = &buf[..];
        let result = read_prelogin_packet_length(&mut cursor);
        assert_eq!(result, Ok(4096));
    }
}
