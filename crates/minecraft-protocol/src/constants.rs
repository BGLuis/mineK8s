/// Limite rígido para qualquer pacote pré-login (Handshake, Status, Ping, Login Start).
/// Pacotes declarando tamanho superior a 4096 bytes (4 KB) devem ser rejeitados imediatamente (RF-GW-04).
pub const MAX_PRELOGIN_PACKET_SIZE: usize = 4096;

/// Número máximo de bytes permitidos para um VarInt (32 bits LEB128).
pub const MAX_VARINT_BYTES: usize = 5;

/// Número máximo de bytes permitidos para um VarLong (64 bits LEB128).
pub const MAX_VARLONG_BYTES: usize = 10;

/// Limite padrão de caracteres para strings no protocolo Minecraft.
pub const MAX_STRING_CHARS: usize = 32767;
