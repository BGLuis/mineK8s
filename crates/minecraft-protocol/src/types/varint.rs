use crate::constants::MAX_VARINT_BYTES;
use crate::error::{ProtocolError, Result};
use bytes::{Buf, BufMut};

/// Representa um inteiro de 32 bits codificado em formato LEB128 de tamanho variável (1 a 5 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct VarInt(pub i32);

impl VarInt {
    /// Decodifica um `VarInt` a partir de um buffer `Buf`.
    ///
    /// Retorna erro em O(1) sem alocação caso:
    /// - O buffer termine antes de encontrar o byte final (`UnexpectedEof`).
    /// - O 5º byte ainda possua o bit de continuação `0x80` ativo (`VarIntTooLarge`).
    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let mut value: i32 = 0;
        for i in 0..MAX_VARINT_BYTES {
            if !buf.has_remaining() {
                return Err(ProtocolError::UnexpectedEof);
            }
            let byte = buf.get_u8();
            value |= ((byte & 0x7F) as i32) << (i * 7);

            if (byte & 0x80) == 0 {
                return Ok(VarInt(value));
            }

            if i == MAX_VARINT_BYTES - 1 {
                // 5º byte com o bit 0x80 ativo é uma violação de limite estrito (VarInt Bomb)
                return Err(ProtocolError::VarIntTooLarge);
            }
        }
        Err(ProtocolError::VarIntTooLarge)
    }

    /// Codifica o `VarInt` em formato LEB128 no buffer `BufMut`.
    pub fn encode(&self, buf: &mut impl BufMut) {
        let mut temp = self.0 as u32;
        loop {
            if (temp & !0x7F) == 0 {
                buf.put_u8(temp as u8);
                break;
            }
            buf.put_u8(((temp & 0x7F) | 0x80) as u8);
            temp >>= 7;
        }
    }

    /// Retorna a quantidade de bytes que a codificação LEB128 deste `VarInt` ocupa (1 a 5 bytes).
    pub fn encoded_len(&self) -> usize {
        let mut temp = self.0 as u32;
        let mut count = 0;
        loop {
            count += 1;
            if (temp & !0x7F) == 0 {
                return count;
            }
            temp >>= 7;
        }
    }
}

impl From<i32> for VarInt {
    fn from(val: i32) -> Self {
        VarInt(val)
    }
}

impl From<VarInt> for i32 {
    fn from(val: VarInt) -> Self {
        val.0
    }
}

impl std::ops::Deref for VarInt {
    type Target = i32;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_varint_valid_boundaries() {
        let test_cases = [
            (0, &[0x00u8][..]),
            (1, &[0x01][..]),
            (127, &[0x7F][..]),
            (128, &[0x80, 0x01][..]),
            (255, &[0xFF, 0x01][..]),
            (2147483647, &[0xFF, 0xFF, 0xFF, 0xFF, 0x07][..]),
            (-1, &[0xFF, 0xFF, 0xFF, 0xFF, 0x0F][..]),
            (-2147483648, &[0x80, 0x80, 0x80, 0x80, 0x08][..]),
        ];

        for (expected_val, expected_bytes) in test_cases {
            // Teste de decodificação
            let mut cursor = expected_bytes;
            let decoded = VarInt::decode(&mut cursor).expect("Failed to decode valid VarInt");
            assert_eq!(decoded.0, expected_val);
            assert_eq!(cursor.len(), 0, "All bytes must be consumed");

            // Teste de codificação
            let mut buf = BytesMut::new();
            decoded.encode(&mut buf);
            assert_eq!(&buf[..], expected_bytes);
            assert_eq!(decoded.encoded_len(), expected_bytes.len());
        }
    }

    #[test]
    fn test_varint_overflow_rejection() {
        // Sequência maliciosa com o bit 0x80 ativo no 5º byte
        let malicious_5_bytes = [0x80, 0x80, 0x80, 0x80, 0x80];
        let mut cursor = &malicious_5_bytes[..];
        let result = VarInt::decode(&mut cursor);
        assert_eq!(result, Err(ProtocolError::VarIntTooLarge));

        // Sequência com 6 bytes com bits de continuação
        let malicious_6_bytes = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01];
        let mut cursor = &malicious_6_bytes[..];
        let result = VarInt::decode(&mut cursor);
        assert_eq!(result, Err(ProtocolError::VarIntTooLarge));
    }

    #[test]
    fn test_varint_unexpected_eof() {
        let incomplete_bytes = [0x80u8]; // Declara continuação mas não tem próximo byte
        let mut cursor = &incomplete_bytes[..];
        let result = VarInt::decode(&mut cursor);
        assert_eq!(result, Err(ProtocolError::UnexpectedEof));
    }
}
