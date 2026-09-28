use crate::constants::MAX_VARLONG_BYTES;
use crate::error::{ProtocolError, Result};
use bytes::{Buf, BufMut};

/// Representa um inteiro de 64 bits codificado em formato LEB128 de tamanho variável (1 a 10 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct VarLong(pub i64);

impl VarLong {
    /// Decodifica um `VarLong` a partir de um buffer `Buf`.
    ///
    /// Retorna erro em O(1) sem alocação caso:
    /// - O buffer termine antes de encontrar o byte final (`UnexpectedEof`).
    /// - O 10º byte ainda possua o bit de continuação `0x80` ativo (`VarLongTooLarge`).
    pub fn decode(buf: &mut impl Buf) -> Result<Self> {
        let mut value: i64 = 0;
        for i in 0..MAX_VARLONG_BYTES {
            if !buf.has_remaining() {
                return Err(ProtocolError::UnexpectedEof);
            }
            let byte = buf.get_u8();
            value |= ((byte & 0x7F) as i64) << (i * 7);

            if (byte & 0x80) == 0 {
                return Ok(VarLong(value));
            }

            if i == MAX_VARLONG_BYTES - 1 {
                return Err(ProtocolError::VarLongTooLarge);
            }
        }
        Err(ProtocolError::VarLongTooLarge)
    }

    /// Codifica o `VarLong` em formato LEB128 no buffer `BufMut`.
    pub fn encode(&self, buf: &mut impl BufMut) {
        let mut temp = self.0 as u64;
        loop {
            if (temp & !0x7F) == 0 {
                buf.put_u8(temp as u8);
                break;
            }
            buf.put_u8(((temp & 0x7F) | 0x80) as u8);
            temp >>= 7;
        }
    }

    /// Retorna a quantidade de bytes que a codificação LEB128 deste `VarLong` ocupa (1 a 10 bytes).
    pub fn encoded_len(&self) -> usize {
        let mut temp = self.0 as u64;
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

impl From<i64> for VarLong {
    fn from(val: i64) -> Self {
        VarLong(val)
    }
}

impl From<VarLong> for i64 {
    fn from(val: VarLong) -> Self {
        val.0
    }
}

impl std::ops::Deref for VarLong {
    type Target = i64;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_varlong_boundaries() {
        let test_cases = [
            (0i64, &[0x00u8][..]),
            (1i64, &[0x01][..]),
            (127i64, &[0x7F][..]),
            (128i64, &[0x80, 0x01][..]),
            (255i64, &[0xFF, 0x01][..]),
            (2147483647i64, &[0xFF, 0xFF, 0xFF, 0xFF, 0x07][..]),
            (
                -1i64,
                &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01][..],
            ),
            (
                9223372036854775807i64,
                &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F][..],
            ),
        ];

        for (expected_val, expected_bytes) in test_cases {
            let mut cursor = &expected_bytes[..];
            let decoded = VarLong::decode(&mut cursor).expect("Failed to decode valid VarLong");
            assert_eq!(decoded.0, expected_val);
            assert_eq!(cursor.len(), 0);

            let mut buf = BytesMut::new();
            decoded.encode(&mut buf);
            assert_eq!(&buf[..], expected_bytes);
            assert_eq!(decoded.encoded_len(), expected_bytes.len());
        }
    }

    #[test]
    fn test_varlong_overflow_rejection() {
        let malicious_10_bytes = [0x80; 10];
        let mut cursor = &malicious_10_bytes[..];
        let result = VarLong::decode(&mut cursor);
        assert_eq!(result, Err(ProtocolError::VarLongTooLarge));
    }
}
