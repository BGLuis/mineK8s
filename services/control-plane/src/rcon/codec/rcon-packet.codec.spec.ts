import { RconPacketCodec, RconPacketType } from './rcon-packet.codec';

describe('RconPacketCodec (RF-RCON-01, RF-RCON-02, RF-RCON-15, Guarda E-01)', () => {
  it('test_rcon_encode_decode_roundtrip: should encode and decode a packet correctly', () => {
    const originalPacket = {
      id: 42,
      type: RconPacketType.SERVERDATA_EXECCOMMAND,
      body: 'whitelist add Steve',
    };

    const encoded = RconPacketCodec.encode(originalPacket);
    expect(encoded).toBeInstanceOf(Buffer);

    // Verify wire length: 4 (length field) + 4 (id) + 4 (type) + body (19) + 2 (nulls) = 33
    expect(encoded.length).toBe(33);
    expect(encoded.readInt32LE(0)).toBe(29); // 4 + 4 + 19 + 2
    expect(encoded.readInt32LE(4)).toBe(42);
    expect(encoded.readInt32LE(8)).toBe(RconPacketType.SERVERDATA_EXECCOMMAND);

    const decodedResult = RconPacketCodec.decode(encoded);
    expect(decodedResult).not.toBeNull();
    expect(decodedResult?.bytesConsumed).toBe(33);
    expect(decodedResult?.packet.id).toBe(42);
    expect(decodedResult?.packet.type).toBe(RconPacketType.SERVERDATA_EXECCOMMAND);
    expect(decodedResult?.packet.body).toBe('whitelist add Steve');
  });

  it('test_rcon_reject_null_byte: should reject null-byte injection in payload', () => {
    const maliciousPacket = {
      id: 1,
      type: RconPacketType.SERVERDATA_EXECCOMMAND,
      body: 'op Steve\0something_else',
    };

    expect(() => RconPacketCodec.encode(maliciousPacket)).toThrow(/Null-byte injection detected/);
  });

  it('test_rcon_packet_fragmentation_reassembly: should handle TCP fragmented streams incrementally', () => {
    const packet = {
      id: 100,
      type: RconPacketType.SERVERDATA_RESPONSE_VALUE,
      body: 'Hello World from Minecraft Server via RCON!',
    };

    const fullBuffer = RconPacketCodec.encode(packet);
    expect(fullBuffer.length).toBeGreaterThan(20);

    // Split into 3 arbitrary chunks
    const chunk1 = fullBuffer.subarray(0, 8);
    const chunk2 = fullBuffer.subarray(8, 25);
    const chunk3 = fullBuffer.subarray(25);

    let accumulator = Buffer.alloc(0);

    // Feed chunk 1 (< 14 bytes)
    accumulator = Buffer.concat([accumulator, chunk1]);
    expect(RconPacketCodec.decode(accumulator)).toBeNull();

    // Feed chunk 2 (still incomplete)
    accumulator = Buffer.concat([accumulator, chunk2]);
    expect(RconPacketCodec.decode(accumulator)).toBeNull();

    // Feed chunk 3 (complete packet)
    accumulator = Buffer.concat([accumulator, chunk3]);
    const result = RconPacketCodec.decode(accumulator);
    expect(result).not.toBeNull();
    expect(result?.packet.id).toBe(100);
    expect(result?.packet.body).toBe('Hello World from Minecraft Server via RCON!');
    expect(result?.bytesConsumed).toBe(fullBuffer.length);
  });

  it('test_rcon_oversized_packet_rejection: should enforce E-01 limits for encode and decode', () => {
    // 1. Client encode payload > 1446 bytes must be rejected (Guarda E-01)
    const oversizedPayload = 'A'.repeat(1447);
    expect(() =>
      RconPacketCodec.encode({
        id: 2,
        type: RconPacketType.SERVERDATA_EXECCOMMAND,
        body: oversizedPayload,
      }),
    ).toThrow(/exceeds maximum allowable client payload of 1446 bytes/);

    // Payload exactly 1446 bytes must be accepted
    const maxPayload = 'A'.repeat(1446);
    expect(() =>
      RconPacketCodec.encode({
        id: 3,
        type: RconPacketType.SERVERDATA_EXECCOMMAND,
        body: maxPayload,
      }),
    ).not.toThrow();

    // 2. Decode packet length < 10 must throw illegal length
    const invalidSmallBuffer = Buffer.alloc(14);
    invalidSmallBuffer.writeInt32LE(9, 0); // length 9 < 10
    expect(() => RconPacketCodec.decode(invalidSmallBuffer)).toThrow(/Illegal packet length/);

    // 3. Decode packet length > 4110 must throw illegal length
    const invalidLargeBuffer = Buffer.alloc(14);
    invalidLargeBuffer.writeInt32LE(4111, 0); // length 4111 > 4110
    expect(() => RconPacketCodec.decode(invalidLargeBuffer)).toThrow(/Illegal packet length/);

    // 4. Large response of 4110 total wire bytes (packetLength = 4106, 4096 body) MUST be accepted (Critério de Aceite Issue #63)
    const largeBody = 'X'.repeat(4096);
    const packetLength = 4 + 4 + 4096 + 2; // 4106
    const totalWire = packetLength + 4; // 4110
    expect(totalWire).toBe(4110);

    const largeServerResponse = Buffer.alloc(totalWire);
    largeServerResponse.writeInt32LE(packetLength, 0);
    largeServerResponse.writeInt32LE(77, 4); // ID
    largeServerResponse.writeInt32LE(RconPacketType.SERVERDATA_RESPONSE_VALUE, 8); // Type
    largeServerResponse.write(largeBody, 12, 'utf-8');
    largeServerResponse.writeUInt8(0, totalWire - 2);
    largeServerResponse.writeUInt8(0, totalWire - 1);

    const largeDecoded = RconPacketCodec.decode(largeServerResponse);
    expect(largeDecoded).not.toBeNull();
    expect(largeDecoded?.packet.id).toBe(77);
    expect(largeDecoded?.packet.body.length).toBe(4096);
    expect(largeDecoded?.bytesConsumed).toBe(4110);
  });

  it('should reject corrupted packet terminators', () => {
    const corruptedBuffer = Buffer.alloc(16);
    corruptedBuffer.writeInt32LE(12, 0); // packet length 12 -> total 16
    corruptedBuffer.writeInt32LE(1, 4);
    corruptedBuffer.writeInt32LE(0, 8);
    corruptedBuffer.writeUInt8(65, 12); // body 'A'
    corruptedBuffer.writeUInt8(66, 13); // body 'B'
    corruptedBuffer.writeUInt8(0, 14); // pad 1
    corruptedBuffer.writeUInt8(1, 15); // corrupted pad 2 (not 0)

    expect(() => RconPacketCodec.decode(corruptedBuffer)).toThrow(/Invalid packet terminators/);
  });
});
