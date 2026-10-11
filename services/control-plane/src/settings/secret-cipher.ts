import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KDF_SALT = 'minekubernetes:app-settings';
const KDF_INFO = 'aes-256-gcm';

/**
 * Encrypts secret settings at rest with AES-256-GCM. The key is derived from JWT_SECRET, so the database dump alone
 * does not reveal them; rotating JWT_SECRET makes the stored secrets unreadable and they must be typed again.
 * The setting key is bound as additional authenticated data, so a ciphertext copied to another row fails to decrypt.
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, KDF_SALT, KDF_INFO, KEY_BYTES));
  }

  encrypt(plain: string, settingKey: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(settingKey));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), body]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':');
  }

  /** Throws when the value was tampered with, belongs to another key or was sealed with another JWT_SECRET. */
  decrypt(sealed: string, settingKey: string): string {
    const [version, iv, tag, body] = sealed.split(':');
    if (version !== VERSION || !iv || !tag || body === undefined) {
      throw new Error('Unsupported secret format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(settingKey));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}
