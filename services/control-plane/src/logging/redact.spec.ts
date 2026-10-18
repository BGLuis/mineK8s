import { redactBody } from './redact';

describe('redactBody', () => {
  it('redacts the secrets of a settings update, which sit under dotted keys inside `values`', () => {
    const body = {
      values: {
        'tailscale.apiKey': 'tskey-api-FAKE-0000000000',
        'cloudflare.apiToken': 'cf-token-FAKE-0000000000',
        'access.publicUrl': 'https://painel.mine.internal',
      },
    };

    const redacted = redactBody(body);

    expect(JSON.stringify(redacted)).not.toContain('FAKE');
    expect(redacted).toEqual({
      values: {
        'tailscale.apiKey': '[Redacted]',
        'cloudflare.apiToken': '[Redacted]',
        'access.publicUrl': 'https://painel.mine.internal',
      },
    });
  });

  it('keeps redacting the top-level keys it always did', () => {
    expect(redactBody({ password: 'x', rcon_password: 'y', name: 'ok' })).toEqual({
      password: '[Redacted]',
      rcon_password: '[Redacted]',
      name: 'ok',
    });
  });

  it('does not let a deeply nested secret through', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'tskey-api-FAKE' } } } } } };

    expect(JSON.stringify(redactBody(deep))).not.toContain('FAKE');
  });
});
