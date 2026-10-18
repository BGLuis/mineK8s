import { SecretCipher } from './secret-cipher';

const JWT_SECRET = 'a-jwt-secret-with-at-least-thirty-two-chars';
const API_KEY = 'tskey-api-FAKE-not-a-real-key';

describe('SecretCipher', () => {
  const cipher = new SecretCipher(JWT_SECRET);

  it('recovers the original value', () => {
    const sealed = cipher.encrypt(API_KEY, 'tailscale.apiKey');

    expect(cipher.decrypt(sealed, 'tailscale.apiKey')).toBe(API_KEY);
  });

  it('never stores the plain value, and seals the same value differently each time', () => {
    const first = cipher.encrypt(API_KEY, 'tailscale.apiKey');
    const second = cipher.encrypt(API_KEY, 'tailscale.apiKey');

    expect(first).not.toContain(API_KEY);
    expect(Buffer.from(first.split(':')[3], 'base64').toString('utf8')).not.toContain(API_KEY);
    expect(first).not.toBe(second);
  });

  it('cannot be opened after JWT_SECRET changes', () => {
    const sealed = cipher.encrypt(API_KEY, 'tailscale.apiKey');

    expect(() =>
      new SecretCipher('another-jwt-secret-with-thirty-two-chars').decrypt(
        sealed,
        'tailscale.apiKey',
      ),
    ).toThrow();
  });

  it('rejects a ciphertext moved to another setting', () => {
    const sealed = cipher.encrypt(API_KEY, 'tailscale.apiKey');

    expect(() => cipher.decrypt(sealed, 'cloudflare.apiToken')).toThrow();
  });

  it('rejects a tampered ciphertext and an unknown format', () => {
    const [version, iv, tag, body] = cipher.encrypt(API_KEY, 'tailscale.apiKey').split(':');
    const flipped = Buffer.from(body, 'base64');
    flipped[0] ^= 0xff;

    expect(() =>
      cipher.decrypt([version, iv, tag, flipped.toString('base64')].join(':'), 'tailscale.apiKey'),
    ).toThrow();
    expect(() => cipher.decrypt(API_KEY, 'tailscale.apiKey')).toThrow('Unsupported secret format');
  });
});
