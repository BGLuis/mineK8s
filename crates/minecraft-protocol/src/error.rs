use thiserror::Error;

pub type Result<T> = std::result::Result<T, ProtocolError>;

#[derive(Error, Debug, PartialEq, Eq, Clone)]
pub enum ProtocolError {
    #[error("VarInt exceeds maximum 5 bytes limit or has continuation bit on 5th byte")]
    VarIntTooLarge,

    #[error("VarLong exceeds maximum 10 bytes limit or has continuation bit on 10th byte")]
    VarLongTooLarge,

    #[error(
        "Pre-login packet size {size} bytes exceeds maximum allowed limit of {max_size} bytes"
    )]
    PacketTooLarge { size: usize, max_size: usize },

    #[error("String length of {size} exceeds maximum limit of {max_size}")]
    StringTooLong { size: usize, max_size: usize },

    #[error("String contains invalid UTF-8 bytes")]
    InvalidUtf8,

    #[error("Unexpected end of buffer while reading protocol data")]
    UnexpectedEof,

    #[error("Invalid packet data: {0}")]
    InvalidData(String),
}
