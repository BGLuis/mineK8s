use bytes::{Buf, BufMut};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};

use crate::error::{ProtocolError, Result};

/// Assinatura binária de 12 bytes do HAProxy PROXY Protocol v2.
/// `\r\n\r\n\x00\r\nQUIT\n`
pub const PROXY_V2_SIGNATURE: &[u8; 12] = b"\x0D\x0A\x0D\x0A\x00\x0D\x0A\x51\x55\x49\x54\x0A";

/// Prefixo de 4 bytes utilizado para detecção rápida de preâmbulo corrompido.
const PROXY_V2_PREFIX_4: &[u8; 4] = b"\x0D\x0A\x0D\x0A";

/// Comando do PROXY Protocol v2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyCommand {
    /// LOCAL (0x00): conexão gerada pelo próprio proxy (heartbeat / healthcheck)
    Local,
    /// PROXY (0x01): conexão proxied em nome de outro cliente
    Proxy,
}

/// Endereços de origem e destino contidos no cabeçalho PROXY v2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyAddress {
    IPv4 {
        src_addr: Ipv4Addr,
        dst_addr: Ipv4Addr,
        src_port: u16,
        dst_port: u16,
    },
    IPv6 {
        src_addr: Ipv6Addr,
        dst_addr: Ipv6Addr,
        src_port: u16,
        dst_port: u16,
    },
    Unspec,
}

impl ProxyAddress {
    pub fn src_socket_addr(&self) -> Option<SocketAddr> {
        match self {
            ProxyAddress::IPv4 {
                src_addr, src_port, ..
            } => Some(SocketAddr::new((*src_addr).into(), *src_port)),
            ProxyAddress::IPv6 {
                src_addr, src_port, ..
            } => Some(SocketAddr::new((*src_addr).into(), *src_port)),
            ProxyAddress::Unspec => None,
        }
    }
}

/// Cabeçalho decodificado do PROXY Protocol v2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyHeader {
    pub command: ProxyCommand,
    pub address: ProxyAddress,
}

impl ProxyHeader {
    pub fn new_ipv4_proxy(
        src_addr: Ipv4Addr,
        src_port: u16,
        dst_addr: Ipv4Addr,
        dst_port: u16,
    ) -> Self {
        Self {
            command: ProxyCommand::Proxy,
            address: ProxyAddress::IPv4 {
                src_addr,
                dst_addr,
                src_port,
                dst_port,
            },
        }
    }

    pub fn new_ipv6_proxy(
        src_addr: Ipv6Addr,
        src_port: u16,
        dst_addr: Ipv6Addr,
        dst_port: u16,
    ) -> Self {
        Self {
            command: ProxyCommand::Proxy,
            address: ProxyAddress::IPv6 {
                src_addr,
                dst_addr,
                src_port,
                dst_port,
            },
        }
    }

    /// Tenta inspecionar e decodificar o cabeçalho PROXY Protocol v2 sem destruir
    /// o buffer se a conexão for TCP nativa direta (não-PROXY).
    ///
    /// - Retorna `Ok(Some(header))` se um cabeçalho PROXY v2 válido foi encontrado e consumido.
    /// - Retorna `Ok(None)` se os bytes não corresponderem à assinatura PROXY (conexão direta).
    /// - Retorna `Err(ProtocolError::CorruptedProxyPreamble)` se o cabeçalho começar com a assinatura
    ///   mas estiver corrompido.
    /// - Retorna `Err(ProtocolError::UnexpectedEof)` se houver início de assinatura mas faltarem bytes.
    pub fn parse(buf: &mut impl Buf) -> Result<Option<Self>> {
        if buf.remaining() < 12 {
            // Se os bytes disponíveis já divergem do preâmbulo, não é PROXY
            let available = buf.chunk();
            let check_len = available.len().min(12);
            if available[..check_len] != PROXY_V2_SIGNATURE[..check_len] {
                return Ok(None);
            }
            return Err(ProtocolError::UnexpectedEof);
        }

        let chunk = buf.chunk();
        if chunk.len() >= 12 {
            if &chunk[..12] != PROXY_V2_SIGNATURE {
                // Se começar com \r\n\r\n mas não bater o restante de QUIT\n, está corrompido
                if &chunk[..4] == PROXY_V2_PREFIX_4 {
                    return Err(ProtocolError::CorruptedProxyPreamble);
                }
                return Ok(None);
            }
        } else {
            // Buffer fragmentado: checagem byte a byte
            let mut prefix = [0u8; 12];
            let mut copy_buf = buf.chunk();
            if copy_buf.len() < 12 {
                return Ok(None);
            }
            copy_buf.copy_to_slice(&mut prefix);
            if &prefix != PROXY_V2_SIGNATURE {
                if &prefix[..4] == PROXY_V2_PREFIX_4 {
                    return Err(ProtocolError::CorruptedProxyPreamble);
                }
                return Ok(None);
            }
        }

        // Se chegou aqui, a assinatura de 12 bytes bateu exatamente!
        if buf.remaining() < 16 {
            return Err(ProtocolError::UnexpectedEof);
        }

        // Consumir os 12 bytes da assinatura
        buf.advance(12);

        // Byte 13: versão e comando (versão deve ser 2)
        let ver_cmd = buf.get_u8();
        let version = ver_cmd >> 4;
        let command_nibble = ver_cmd & 0x0F;

        if version != 2 {
            return Err(ProtocolError::InvalidProxyHeader(format!(
                "Unsupported PROXY version {}",
                version
            )));
        }

        let command = match command_nibble {
            0x00 => ProxyCommand::Local,
            0x01 => ProxyCommand::Proxy,
            other => {
                return Err(ProtocolError::InvalidProxyHeader(format!(
                    "Unknown command 0x{:02x}",
                    other
                )))
            }
        };

        // Byte 14: família e protocolo de transporte
        let fam_proto = buf.get_u8();
        let family = fam_proto >> 4;
        let proto = fam_proto & 0x0F;

        // Bytes 15 e 16: comprimento do restante do cabeçalho
        let length = buf.get_u16() as usize;

        if buf.remaining() < length {
            return Err(ProtocolError::UnexpectedEof);
        }

        let address = match (family, proto) {
            (0x01, 0x01) => {
                // AF_INET, STREAM (IPv4 TCP)
                if length < 12 {
                    return Err(ProtocolError::InvalidProxyHeader(
                        "Length too short for IPv4 addresses".into(),
                    ));
                }
                let src_ip = Ipv4Addr::from(buf.get_u32());
                let dst_ip = Ipv4Addr::from(buf.get_u32());
                let src_port = buf.get_u16();
                let dst_port = buf.get_u16();

                // Consumir quaisquer TLVs adicionais
                let remaining_tlvs = length - 12;
                if remaining_tlvs > 0 {
                    buf.advance(remaining_tlvs);
                }

                ProxyAddress::IPv4 {
                    src_addr: src_ip,
                    dst_addr: dst_ip,
                    src_port,
                    dst_port,
                }
            }
            (0x02, 0x01) => {
                // AF_INET6, STREAM (IPv6 TCP)
                if length < 36 {
                    return Err(ProtocolError::InvalidProxyHeader(
                        "Length too short for IPv6 addresses".into(),
                    ));
                }
                let src_ip = Ipv6Addr::from(buf.get_u128());
                let dst_ip = Ipv6Addr::from(buf.get_u128());
                let src_port = buf.get_u16();
                let dst_port = buf.get_u16();

                let remaining_tlvs = length - 36;
                if remaining_tlvs > 0 {
                    buf.advance(remaining_tlvs);
                }

                ProxyAddress::IPv6 {
                    src_addr: src_ip,
                    dst_addr: dst_ip,
                    src_port,
                    dst_port,
                }
            }
            _ => {
                // Família não especificada / UNSPEC
                buf.advance(length);
                ProxyAddress::Unspec
            }
        };

        Ok(Some(ProxyHeader { command, address }))
    }

    /// Codifica o cabeçalho PROXY Protocol v2 para transmissão upstream.
    pub fn encode(&self, buf: &mut impl BufMut) {
        buf.put_slice(PROXY_V2_SIGNATURE);

        let cmd_nibble = match self.command {
            ProxyCommand::Local => 0x00,
            ProxyCommand::Proxy => 0x01,
        };
        let ver_cmd = (2 << 4) | cmd_nibble;
        buf.put_u8(ver_cmd);

        match &self.address {
            ProxyAddress::IPv4 {
                src_addr,
                dst_addr,
                src_port,
                dst_port,
            } => {
                buf.put_u8((0x01 << 4) | 0x01); // AF_INET + STREAM
                buf.put_u16(12); // length = 12
                buf.put_slice(&src_addr.octets());
                buf.put_slice(&dst_addr.octets());
                buf.put_u16(*src_port);
                buf.put_u16(*dst_port);
            }
            ProxyAddress::IPv6 {
                src_addr,
                dst_addr,
                src_port,
                dst_port,
            } => {
                buf.put_u8((0x02 << 4) | 0x01); // AF_INET6 + STREAM
                buf.put_u16(36); // length = 36
                buf.put_slice(&src_addr.octets());
                buf.put_slice(&dst_addr.octets());
                buf.put_u16(*src_port);
                buf.put_u16(*dst_port);
            }
            ProxyAddress::Unspec => {
                buf.put_u8(0x00); // AF_UNSPEC
                buf.put_u16(0); // length = 0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_proxy_v2_ipv4_roundtrip() {
        let header = ProxyHeader::new_ipv4_proxy(
            Ipv4Addr::new(192, 168, 1, 50),
            12345,
            Ipv4Addr::new(10, 0, 0, 1),
            25565,
        );

        let mut buf = BytesMut::new();
        header.encode(&mut buf);

        let mut cursor = &buf[..];
        let decoded = ProxyHeader::parse(&mut cursor)
            .expect("Parse valid PROXY v2")
            .expect("Must be Some");

        assert_eq!(decoded, header);
        assert_eq!(cursor.len(), 0);
    }

    #[test]
    fn test_proxy_v2_ipv6_roundtrip() {
        let header = ProxyHeader::new_ipv6_proxy(
            "fd7a:115c:a1e0::1".parse().unwrap(),
            54321,
            "fd7a:115c:a1e0::2".parse().unwrap(),
            25565,
        );

        let mut buf = BytesMut::new();
        header.encode(&mut buf);

        let mut cursor = &buf[..];
        let decoded = ProxyHeader::parse(&mut cursor)
            .expect("Parse valid IPv6 PROXY v2")
            .expect("Must be Some");

        assert_eq!(decoded, header);
        assert_eq!(cursor.len(), 0);
    }

    #[test]
    fn test_non_proxy_stream_passthrough() {
        // Simula o início de um pacote Minecraft Handshake direto: [0x10, 0x00, ...]
        let raw_mc_data = [0x10u8, 0x00, 0x02, 0x09];
        let mut cursor = &raw_mc_data[..];
        let result = ProxyHeader::parse(&mut cursor).expect("Parse non-proxy");
        assert_eq!(result, None);
        assert_eq!(
            cursor.len(),
            4,
            "Buffer must not be consumed for direct TCP"
        );
    }

    #[test]
    fn test_corrupted_preamble_rejection() {
        // Começa com \r\n\r\n mas o resto está corrompido
        let mut corrupted = [0u8; 16];
        corrupted[..4].copy_from_slice(b"\x0D\x0A\x0D\x0A");
        corrupted[4..12].copy_from_slice(b"BAD_PREA");

        let mut cursor = &corrupted[..];
        let result = ProxyHeader::parse(&mut cursor);
        assert_eq!(result, Err(ProtocolError::CorruptedProxyPreamble));
    }
}
