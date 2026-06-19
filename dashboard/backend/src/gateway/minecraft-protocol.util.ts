export class MinecraftProtocol {
  /** Leitor de VarInt (retorna valor e quantos bytes consumiu) */
  static readVarInt(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
    let numRead = 0;
    let result = 0;
    let read: number;
    do {
      if (offset + numRead >= buffer.length) throw new Error('Buffer muito curto para VarInt');
      read = buffer.readUInt8(offset + numRead);
      const value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error('VarInt muito longo');
    } while ((read & 0b10000000) !== 0);
    return { value: result, bytesRead: numRead };
  }

  /** Lemos a String que no protocolo MC é um VarInt de tamanho seguido de UTF-8 */
  static readString(buffer: Buffer, offset: number): { value: string; bytesRead: number } {
    const lenVarInt = this.readVarInt(buffer, offset);
    const strOffset = offset + lenVarInt.bytesRead;
    const strLen = lenVarInt.value;
    
    if (strOffset + strLen > buffer.length) {
      throw new Error('Buffer muito curto para ler a string');
    }
    
    const value = buffer.toString('utf8', strOffset, strOffset + strLen);
    return { value, bytesRead: lenVarInt.bytesRead + strLen };
  }

  /** Escrever VarInt em um array */
  static writeVarInt(value: number): number[] {
    const bytes: number[] = [];
    do {
      let temp = value & 0b01111111;
      value >>>= 7;
      if (value !== 0) {
        temp |= 0b10000000;
      }
      bytes.push(temp);
    } while (value !== 0);
    return bytes;
  }

  /** Cria um pacote de Disconnect (Login Phase - Packet ID 0x00) */
  static createDisconnectPacket(message: string): Buffer {
    const chatComponent = JSON.stringify({ text: message, color: 'red' });
    const chatBytes = Buffer.from(chatComponent, 'utf8');
    
    const strLenVarInt = this.writeVarInt(chatBytes.length);
    const packetId = [0x00];
    
    // Tamanho do pacote = ID (1 byte) + VarInt length da string + string bytes
    const packetDataLen = packetId.length + strLenVarInt.length + chatBytes.length;
    const packetLenVarInt = this.writeVarInt(packetDataLen);
    
    return Buffer.concat([
      Buffer.from(packetLenVarInt),
      Buffer.from(packetId),
      Buffer.from(strLenVarInt),
      chatBytes
    ]);
  }
}
