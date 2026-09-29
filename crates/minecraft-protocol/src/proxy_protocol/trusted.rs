use bytes::Buf;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use crate::error::{ProtocolError, Result};
use crate::proxy_protocol::header::ProxyHeader;

/// Regra de correspondência para IPs confiáveis (IP único ou bloco CIDR).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IpMatcher {
    Single(IpAddr),
    V4Cidr(Ipv4Addr, u8),
    V6Cidr(Ipv6Addr, u8),
}

impl IpMatcher {
    pub fn matches(&self, ip: &IpAddr) -> bool {
        match (self, ip) {
            (IpMatcher::Single(expected), actual) => expected == actual,
            (IpMatcher::V4Cidr(net, prefix), IpAddr::V4(actual)) => {
                if *prefix == 0 {
                    return true;
                }
                if *prefix > 32 {
                    return false;
                }
                let shift = 32 - prefix;
                (u32::from(*net) >> shift) == (u32::from(*actual) >> shift)
            }
            (IpMatcher::V6Cidr(net, prefix), IpAddr::V6(actual)) => {
                if *prefix == 0 {
                    return true;
                }
                if *prefix > 128 {
                    return false;
                }
                let shift = 128 - prefix;
                (u128::from(*net) >> shift) == (u128::from(*actual) >> shift)
            }
            _ => false,
        }
    }
}

/// Política de tratamento caso um IP não confiável envie cabeçalho PROXY v2 (RF-GW-06).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UntrustedProxyPolicy {
    /// O cabeçalho forjado é consumido e descartado/ignorado; a conexão prossegue com o IP real do socket.
    #[default]
    Ignore,
    /// A conexão é abortada imediatamente com erro para prevenir tentativas de spoofing.
    Reject,
}

/// Filtro de endereços e sub-redes autorizadas a injetar PROXY Protocol v2 (TRUSTED_PROXY_IPS).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedProxyFilter {
    matchers: Vec<IpMatcher>,
}

impl Default for TrustedProxyFilter {
    /// Padrão de segurança: apenas localhost (127.0.0.1 e ::1).
    fn default() -> Self {
        Self {
            matchers: vec![
                IpMatcher::Single(IpAddr::V4(Ipv4Addr::LOCALHOST)),
                IpMatcher::Single(IpAddr::V6(Ipv6Addr::LOCALHOST)),
            ],
        }
    }
}

impl TrustedProxyFilter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cria o filtro a partir de uma string com valores separados por vírgula (ex.: "127.0.0.1,::1,10.0.0.0/8").
    pub fn from_csv(csv: &str) -> Self {
        let mut matchers = Vec::new();
        for item in csv.split(',') {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(matcher) = Self::parse_entry(trimmed) {
                matchers.push(matcher);
            }
        }
        Self { matchers }
    }

    fn parse_entry(entry: &str) -> Option<IpMatcher> {
        if let Some((ip_part, prefix_part)) = entry.split_once('/') {
            let prefix: u8 = prefix_part.parse().ok()?;
            if let Ok(v4) = ip_part.parse::<Ipv4Addr>() {
                if prefix <= 32 {
                    return Some(IpMatcher::V4Cidr(v4, prefix));
                }
            } else if let Ok(v6) = ip_part.parse::<Ipv6Addr>() {
                if prefix <= 128 {
                    return Some(IpMatcher::V6Cidr(v6, prefix));
                }
            }
        } else if let Ok(ip) = entry.parse::<IpAddr>() {
            return Some(IpMatcher::Single(ip));
        }
        None
    }

    pub fn add_matcher(&mut self, matcher: IpMatcher) {
        self.matchers.push(matcher);
    }

    /// Verifica se o IP físico do socket é um proxy de confiança autorizado.
    pub fn is_trusted(&self, ip: &IpAddr) -> bool {
        self.matchers.iter().any(|m| m.matches(ip))
    }

    /// Processa a detecção de PROXY v2 aplicando a fronteira de confiança (RF-GW-06).
    ///
    /// - Se for conexão nativa (sem PROXY v2): retorna `Ok(None)`.
    /// - Se for PROXY v2 de IP de confiança: consome o cabeçalho e retorna `Ok(Some(src_socket_addr))`.
    /// - Se for PROXY v2 de IP NÃO confiável:
    ///   - `Policy::Ignore`: consome e descarta o cabeçalho forjado, retornando `Ok(None)`.
    ///   - `Policy::Reject`: retorna `Err(ProtocolError::UntrustedProxy(*peer_ip))`.
    pub fn resolve_proxy_origin(
        &self,
        buf: &mut impl Buf,
        peer_ip: &IpAddr,
        policy: UntrustedProxyPolicy,
    ) -> Result<Option<SocketAddr>> {
        let parsed_header = ProxyHeader::parse(buf)?;
        match parsed_header {
            None => Ok(None),
            Some(header) => {
                if self.is_trusted(peer_ip) {
                    Ok(header.address.src_socket_addr())
                } else {
                    match policy {
                        UntrustedProxyPolicy::Ignore => {
                            // Cabeçalho PROXY v2 forjado foi consumido e ignorado com sucesso
                            Ok(None)
                        }
                        UntrustedProxyPolicy::Reject => {
                            Err(ProtocolError::UntrustedProxy(*peer_ip))
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_trusted_proxy_filter_defaults() {
        let filter = TrustedProxyFilter::default();
        assert!(filter.is_trusted(&"127.0.0.1".parse().unwrap()));
        assert!(filter.is_trusted(&"::1".parse().unwrap()));
        assert!(!filter.is_trusted(&"192.168.1.100".parse().unwrap()));
        assert!(!filter.is_trusted(&"100.64.0.1".parse().unwrap()));
    }

    #[test]
    fn test_trusted_proxy_filter_cidr() {
        let filter = TrustedProxyFilter::from_csv("10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16");
        assert!(filter.is_trusted(&"10.244.0.15".parse().unwrap()));
        assert!(filter.is_trusted(&"172.16.5.1".parse().unwrap()));
        assert!(filter.is_trusted(&"192.168.1.50".parse().unwrap()));
        assert!(!filter.is_trusted(&"100.64.0.1".parse().unwrap()));
    }

    #[test]
    fn test_untrusted_proxy_ignored() {
        let filter = TrustedProxyFilter::default();
        let untrusted_peer: IpAddr = "100.64.0.5".parse().unwrap(); // IP de jogador na Tailnet

        let forged_header = ProxyHeader::new_ipv4_proxy(
            "100.64.0.1".parse().unwrap(), // Tentando fingir que é o admin
            12345,
            "10.0.0.1".parse().unwrap(),
            25565,
        );

        let mut buf = BytesMut::new();
        forged_header.encode(&mut buf);

        // Com política Ignore (padrão): o cabeçalho forjado é consumido e ignorado (retorna None)
        let mut cursor = &buf[..];
        let result = filter
            .resolve_proxy_origin(&mut cursor, &untrusted_peer, UntrustedProxyPolicy::Ignore)
            .expect("Must not error when ignoring untrusted proxy");

        assert_eq!(result, None);
        assert_eq!(
            cursor.len(),
            0,
            "Spoofed header bytes must be consumed and discarded"
        );
    }

    #[test]
    fn test_untrusted_proxy_rejected() {
        let filter = TrustedProxyFilter::default();
        let untrusted_peer: IpAddr = "100.64.0.5".parse().unwrap();

        let forged_header = ProxyHeader::new_ipv4_proxy(
            "100.64.0.1".parse().unwrap(),
            12345,
            "10.0.0.1".parse().unwrap(),
            25565,
        );

        let mut buf = BytesMut::new();
        forged_header.encode(&mut buf);

        let mut cursor = &buf[..];
        let result =
            filter.resolve_proxy_origin(&mut cursor, &untrusted_peer, UntrustedProxyPolicy::Reject);

        assert_eq!(result, Err(ProtocolError::UntrustedProxy(untrusted_peer)));
    }

    #[test]
    fn test_trusted_proxy_accepted() {
        let filter = TrustedProxyFilter::default();
        let trusted_peer: IpAddr = "127.0.0.1".parse().unwrap();

        let real_client_ip: Ipv4Addr = "189.40.12.34".parse().unwrap();
        let header =
            ProxyHeader::new_ipv4_proxy(real_client_ip, 54321, "127.0.0.1".parse().unwrap(), 25565);

        let mut buf = BytesMut::new();
        header.encode(&mut buf);

        let mut cursor = &buf[..];
        let result = filter
            .resolve_proxy_origin(&mut cursor, &trusted_peer, UntrustedProxyPolicy::Ignore)
            .expect("Must accept trusted proxy");

        assert_eq!(
            result,
            Some(SocketAddr::new(IpAddr::V4(real_client_ip), 54321))
        );
    }
}
