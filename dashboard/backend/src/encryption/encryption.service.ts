import {
	scrypt as _scrypt,
	createCipheriv,
	createDecipheriv,
	randomBytes,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../app-config/app-config.service';

const scrypt = promisify(_scrypt);

@Injectable()
export class EncryptionService {
	// Chave de 32 bytes para AES-256-GCM. Em um ambiente real,
	// você pegaria isso do AppConfigService ou de um KMS.
	private readonly algorithm = 'aes-256-gcm';
	private readonly encryptionKey: Buffer;

	constructor(private readonly config: AppConfigService) {
		// Usa uma chave fixa para a demonstração (ou a partir de var de ambiente)
		// O ideal é a variável de ambiente fornecer 32 caracteres
		const envKey = this.config.cfApiKey.padEnd(32, '0').slice(0, 32);
		this.encryptionKey = Buffer.from(envKey, 'utf-8');
	}

	// ==========================================
	// Criptografia Simétrica (Ex: Dados sensíveis)
	// ==========================================

	encryptData(text: string): string {
		const iv = randomBytes(16);
		const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
		let encrypted = cipher.update(text, 'utf8', 'hex');
		encrypted += cipher.final('hex');
		const authTag = cipher.getAuthTag().toString('hex');
		return `${iv.toString('hex')}:${authTag}:${encrypted}`;
	}

	decryptData(encryptedText: string): string {
		const parts = encryptedText.split(':');
		if (parts.length !== 3) {
			throw new Error('Invalid encrypted text format');
		}
		const iv = Buffer.from(parts[0], 'hex');
		const authTag = Buffer.from(parts[1], 'hex');
		const encryptedData = parts[2];
		const decipher = createDecipheriv(
			this.algorithm,
			this.encryptionKey,
			iv,
		);
		decipher.setAuthTag(authTag);
		let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	}

	// ==========================================
	// Hashing Unidirecional (Ex: Senhas)
	// ==========================================

	async hashPassword(password: string): Promise<string> {
		const salt = randomBytes(16).toString('hex');
		// 64 bytes de comprimento para a chave
		const hash = (await scrypt(password, salt, 64)) as Buffer;
		return `${hash.toString('hex')}.${salt}`;
	}

	async comparePassword(
		storedPasswordHash: string,
		suppliedPassword: string,
	): Promise<boolean> {
		const [hash, salt] = storedPasswordHash.split('.');
		if (!hash || !salt) return false;

		const hashBuffer = (await scrypt(suppliedPassword, salt, 64)) as Buffer;
		return hashBuffer.toString('hex') === hash;
	}
}
