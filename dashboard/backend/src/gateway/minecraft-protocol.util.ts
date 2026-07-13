export namespace MinecraftProtocol {
	/** Leitor de VarInt (retorna valor e quantos bytes consumiu) */
	export function readVarInt(
		buffer: Buffer,
		offset: number,
	): { value: number; bytesRead: number } {
		let numRead = 0;
		let result = 0;
		let read = 0;
		let value: number;
		do {
			if (offset + read >= buffer.length) break;
			value = buffer[offset + read];
			result |= (value & 0x7f) << (7 * numRead);
			numRead++;
			read++;
			if (numRead > 5) {
				break; // VarInt é no máximo 5 bytes
			}
		} while ((value & 0x80) !== 0);

		return { value: result, bytesRead: read };
	}

	/** Lemos a String que no protocolo MC é um VarInt de tamanho seguido de UTF-8 */
	export function readString(
		buffer: Buffer,
		offset: number,
	): { value: string; bytesRead: number } {
		const lengthData = readVarInt(buffer, offset);
		const stringOffset = offset + lengthData.bytesRead;
		const stringValue = buffer.toString(
			'utf8',
			stringOffset,
			stringOffset + lengthData.value,
		);
		return {
			value: stringValue,
			bytesRead: lengthData.bytesRead + lengthData.value,
		};
	}

	/** Escrever VarInt em um array */
	export function writeVarInt(value: number): number[] {
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
	export function createDisconnectPacket(message: string): Buffer {
		const chatComponent = JSON.stringify({ text: message, color: 'red' });
		const chatBytes = Buffer.from(chatComponent, 'utf8');

		const packetIdBytes = writeVarInt(0x00);
		const stringLengthBytes = writeVarInt(chatBytes.length);

		const dataLength =
			packetIdBytes.length + stringLengthBytes.length + chatBytes.length;
		const dataLengthBytes = writeVarInt(dataLength);

		return Buffer.concat([
			Buffer.from(dataLengthBytes),
			Buffer.from(packetIdBytes),
			Buffer.from(stringLengthBytes),
			chatBytes,
		]);
	}
}
