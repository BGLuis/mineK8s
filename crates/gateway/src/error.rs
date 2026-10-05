use std::net::IpAddr;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GatewayError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Minecraft protocol error: {0}")]
    Protocol(#[from] minecraft_protocol::ProtocolError),

    #[error("Falha ao resolver o endereço do upstream {host}: {source}")]
    UpstreamResolution {
        host: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Handshake timeout: conexão excedeu limite de 5.0 segundos")]
    HandshakeTimeout,

    #[error("Rate limit excedido para IP: {0}")]
    RateLimited(IpAddr),

    #[error("Conexão encerrada pelo cliente")]
    ConnectionClosed,

    #[error("Transição de estado inválida: {0}")]
    InvalidState(String),
}

pub type Result<T> = std::result::Result<T, GatewayError>;
