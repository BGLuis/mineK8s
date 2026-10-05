export enum RconPacketType {
  SERVERDATA_RESPONSE_VALUE = 0,
  SERVERDATA_EXECCOMMAND = 2,
  SERVERDATA_AUTH_RESPONSE = 2,
  SERVERDATA_AUTH = 3,
}

export interface RconPacket {
  id: number;
  type: number;
  body: string;
}

export class RconPacketCodec {
  public static readonly HEADER_SIZE = 12; // Length (4) + ID (4) + Type (4)
  public static readonly MIN_PACKET_SIZE = 10; // ID(4) + Type(4) + Empty Body(0) + 2 nulls
  // E-01: Client-to-server payload must not exceed 1446 bytes
  public static readonly MAX_ENCODE_PAYLOAD_SIZE = 1446;
  public static readonly MAX_ENCODE_PACKET_SIZE = 1460; // 4 + 4 + 1446 + 2
  // E-01: Server-to-client packets can have up to 4096 bytes body -> 4106 packet length (4110 total wire bytes)
  public static readonly MAX_DECODE_PACKET_SIZE = 4110;

  /**
   * Codifica um pacote RCON binário garantindo integridade Little-Endian.
   * RF-RCON-01, RF-RCON-02 e Guarda E-01.
   */
  public static encode(packet: RconPacket): Buffer {
    if (packet.body.includes('\0')) {
      throw new Error('RCON Security Violation: Null-byte injection detected in command payload');
    }

    const bodyBuffer = Buffer.from(packet.body, 'utf-8');
    if (bodyBuffer.length > this.MAX_ENCODE_PAYLOAD_SIZE) {
      throw new Error(
        `RCON Encode Error: Payload length (${bodyBuffer.length}) exceeds maximum allowable client payload of ${this.MAX_ENCODE_PAYLOAD_SIZE} bytes (Guarda E-01)`,
      );
    }

    const packetLength = 4 + 4 + bodyBuffer.length + 2;
    const buffer = Buffer.alloc(packetLength + 4);
    buffer.writeInt32LE(packetLength, 0);
    buffer.writeInt32LE(packet.id, 4);
    buffer.writeInt32LE(packet.type, 8);
    bodyBuffer.copy(buffer, 12);
    buffer.writeUInt8(0, 12 + bodyBuffer.length);
    buffer.writeUInt8(0, 12 + bodyBuffer.length + 1);

    return buffer;
  }

  /**
   * Decodifica o próximo pacote completo contido no buffer acumulador.
   * Retorna null se os bytes disponíveis forem insuficientes.
   * Suporta respostas de até 4110 bytes (Guarda E-01).
   */
  public static decode(accumulator: Buffer): { packet: RconPacket; bytesConsumed: number } | null {
    if (accumulator.length < 14) {
      return null;
    }

    const packetLength = accumulator.readInt32LE(0);
    if (packetLength < this.MIN_PACKET_SIZE || packetLength > this.MAX_DECODE_PACKET_SIZE) {
      throw new Error(
        `RCON Protocol Error: Illegal packet length ${packetLength} (expected between ${this.MIN_PACKET_SIZE} and ${this.MAX_DECODE_PACKET_SIZE})`,
      );
    }

    const totalExpectedBytes = packetLength + 4;
    if (accumulator.length < totalExpectedBytes) {
      return null; // Aguardando chegada de mais fragmentos TCP
    }

    // Validação de delimitadores null-byte finais
    const pad1 = accumulator.readUInt8(totalExpectedBytes - 2);
    const pad2 = accumulator.readUInt8(totalExpectedBytes - 1);
    if (pad1 !== 0 || pad2 !== 0) {
      throw new Error('RCON Protocol Error: Invalid packet terminators (expected 0x00 0x00)');
    }

    const id = accumulator.readInt32LE(4);
    const type = accumulator.readInt32LE(8);
    const body = accumulator.toString('utf-8', 12, totalExpectedBytes - 2);

    return {
      packet: { id, type, body },
      bytesConsumed: totalExpectedBytes,
    };
  }
}
