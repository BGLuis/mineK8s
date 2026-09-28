use crate::error::{ProtocolError, Result};
use crate::types::varint::VarInt;
use bytes::{Buf, BufMut};

/// Decodifica uma string UTF-8 com prefixo VarInt e limite de caracteres.
///
/// Falha rapidamente caso o tamanho declarado exceda a cota ou os bytes sejam UTF-8 inválido.
pub fn decode_string(buf: &mut impl Buf, max_chars: usize) -> Result<String> {
    let byte_len = VarInt::decode(buf)?.0;
    if byte_len < 0 {
        return Err(ProtocolError::InvalidData(
            "String length cannot be negative".into(),
        ));
    }
    let byte_len = byte_len as usize;

    // Em UTF-8, cada caractere tem no máximo 4 bytes.
    let max_possible_bytes = max_chars.saturating_mul(4);
    if byte_len > max_possible_bytes {
        return Err(ProtocolError::StringTooLong {
            size: byte_len,
            max_size: max_possible_bytes,
        });
    }

    if buf.remaining() < byte_len {
        return Err(ProtocolError::UnexpectedEof);
    }

    let mut raw_bytes = vec![0u8; byte_len];
    buf.copy_to_slice(&mut raw_bytes);

    let string = String::from_utf8(raw_bytes).map_err(|_| ProtocolError::InvalidUtf8)?;
    let char_count = string.chars().count();
    if char_count > max_chars {
        return Err(ProtocolError::StringTooLong {
            size: char_count,
            max_size: max_chars,
        });
    }

    Ok(string)
}

/// Codifica uma string UTF-8 precedida pelo seu tamanho em bytes codificado como `VarInt`.
pub fn encode_string(s: &str, buf: &mut impl BufMut) {
    let bytes = s.as_bytes();
    let len = VarInt(bytes.len() as i32);
    len.encode(buf);
    buf.put_slice(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_string_roundtrip() {
        let text = "survival.mine.lan";
        let mut buf = BytesMut::new();
        encode_string(text, &mut buf);

        let mut cursor = &buf[..];
        let decoded = decode_string(&mut cursor, 255).expect("Valid string decode");
        assert_eq!(decoded, text);
        assert_eq!(cursor.len(), 0);
    }

    #[test]
    fn test_string_too_long() {
        let text = "abcdefgh";
        let mut buf = BytesMut::new();
        encode_string(text, &mut buf);

        let mut cursor = &buf[..];
        let err = decode_string(&mut cursor, 5); // Teto de 5 caracteres
        assert!(matches!(err, Err(ProtocolError::StringTooLong { .. })));
    }

    #[test]
    fn test_string_invalid_utf8() {
        let mut buf = BytesMut::new();
        let len = VarInt(2);
        len.encode(&mut buf);
        buf.put_slice(&[0xFF, 0xFF]); // Bytes inválidos em UTF-8

        let mut cursor = &buf[..];
        let err = decode_string(&mut cursor, 10);
        assert_eq!(err, Err(ProtocolError::InvalidUtf8));
    }
}
