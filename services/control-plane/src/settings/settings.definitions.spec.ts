import { DEFINITIONS_BY_KEY, SETTING_DEFINITIONS, parseSetting } from './settings.definitions';

const parse = (key: string, input: unknown) => parseSetting(DEFINITIONS_BY_KEY.get(key)!, input);

describe('parseSetting', () => {
  it.each([
    ['access.publicUrl', ' https://painel.mine.internal/ ', 'https://painel.mine.internal'],
    ['access.publicUrl', 'http://luisarch:8080', 'http://luisarch:8080'],
    ['access.publicUrl', 'https://host.example/painel//', 'https://host.example/painel'],
    ['access.worldsDomain', 'Mine.Internal', 'mine.internal'],
    ['cloudflare.rootDomain', 'minek8s.net', 'minek8s.net'],
    ['tailscale.tailnet', '-', '-'],
    ['tailscale.tailnet', 'exemplo.ts.net', 'exemplo.ts.net'],
    ['tailscale.tailnet', 'user@gmail.com', 'user@gmail.com'],
    ['cloudflare.zoneId', '023e105f4ecef8ad9ca31a8372d0c353', '023e105f4ecef8ad9ca31a8372d0c353'],
    ['healthBot.intervalMs', 60000, '60000'],
    ['healthBot.intervalMs', '60000', '60000'],
    ['healthBot.enabled', false, 'false'],
    ['healthBot.enabled', 'TRUE', 'true'],
    ['tailscale.apiKey', '  tskey-api-FAKE-1234  ', 'tskey-api-FAKE-1234'],
  ])('accepts %s = %j', (key, input, stored) => {
    expect(parse(key, input)).toEqual({ ok: true, stored });
  });

  it.each([
    ['access.publicUrl', 'painel.mine.internal'],
    ['access.publicUrl', 'ftp://painel.mine.internal'],
    ['access.publicUrl', 'https://user:pass@painel.mine.internal'],
    ['access.publicUrl', 'https://painel.mine.internal/?a=1'],
    ['access.publicUrl', 42],
    ['access.worldsDomain', 'mine internal'],
    ['access.worldsDomain', 'https://mine.internal'],
    ['access.worldsDomain', ''],
    ['tailscale.tailnet', 'has space'],
    ['cloudflare.zoneId', 'bad/zone'],
    ['healthBot.intervalMs', 10],
    ['healthBot.intervalMs', 1.5],
    ['healthBot.intervalMs', 'abc'],
    ['healthBot.intervalMs', ''],
    ['healthBot.timeoutMs', 999_999_999],
    ['healthBot.enabled', 'yes'],
    ['healthBot.enabled', 1],
    ['tailscale.apiKey', 'short'],
    ['tailscale.apiKey', 'has a space in the key'],
    ['tailscale.apiKey', true],
  ])('rejects %s = %j', (key, input) => {
    const result = parse(key, input);

    expect(result.ok).toBe(false);
  });

  it('defines every secret without a default, so one can never be exposed as a default', () => {
    const secrets = SETTING_DEFINITIONS.filter((d) => d.type === 'secret');

    expect(secrets.map((d) => d.key).sort()).toEqual(['cloudflare.apiToken', 'tailscale.apiKey']);
    expect(secrets.every((d) => d.defaultValue === null)).toBe(true);
  });

  it('keeps invite keys off and node sharing on by default', () => {
    expect(DEFINITIONS_BY_KEY.get('tailscale.inviteKeyEnabled')?.defaultValue).toBe(false);
    expect(DEFINITIONS_BY_KEY.get('tailscale.nodeSharingEnabled')?.defaultValue).toBe(true);
  });
});
