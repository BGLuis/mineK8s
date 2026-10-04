import { AppConfigService } from '@config/app-config.service';

import { TrustedProxyService } from './trusted-proxy.service';

const proxies = (...entries: string[]) =>
  new TrustedProxyService({ authTrustedProxyIps: entries } as AppConfigService);

describe('TrustedProxyService (#91)', () => {
  describe('isTrusted', () => {
    it('trusts nobody when nothing is configured (fail closed)', () => {
      const service = proxies();

      expect(service.isTrusted('127.0.0.1')).toBe(false);
      expect(service.isTrusted('100.100.1.1')).toBe(false);
    });

    it('trusts exact addresses and CIDR ranges, v4 and v6, also when reported as IPv4-mapped', () => {
      const service = proxies('10.0.0.5', '192.168.0.0/16', '::1', 'fd7a:115c:a1e0::/48');

      expect(service.isTrusted('10.0.0.5')).toBe(true);
      expect(service.isTrusted('::ffff:10.0.0.5')).toBe(true);
      expect(service.isTrusted('192.168.44.2')).toBe(true);
      expect(service.isTrusted('::1')).toBe(true);
      expect(service.isTrusted('fd7a:115c:a1e0::9')).toBe(true);
      expect(service.isTrusted('10.0.0.6')).toBe(false);
      expect(service.isTrusted('192.169.0.1')).toBe(false);
    });

    it('does not trust a missing or malformed peer', () => {
      const service = proxies('0.0.0.0/0');

      expect(service.isTrusted(undefined)).toBe(false);
      expect(service.isTrusted('not-an-ip')).toBe(false);
    });

    it.each(['10.0.0.5/33', 'banana', '10.0.0.0/abc', '::1/129'])(
      'refuses to boot with the invalid entry %s',
      (entry) => {
        expect(() => proxies(entry)).toThrow(/AUTH_TRUSTED_PROXY_IPS/);
      },
    );
  });

  describe('resolveClientIp', () => {
    const service = proxies('10.0.0.5', '10.0.0.6');

    it('uses the TCP peer and ignores X-Forwarded-For when the peer is not a trusted proxy', () => {
      expect(service.resolveClientIp('203.0.113.9', '100.64.1.1')).toBe('203.0.113.9');
    });

    it('takes the client from X-Forwarded-For when the peer is a trusted proxy', () => {
      expect(service.resolveClientIp('10.0.0.5', '100.64.1.1')).toBe('100.64.1.1');
    });

    it('skips trusted hops and ignores what the client wrote to the left of the proxy chain', () => {
      expect(service.resolveClientIp('10.0.0.5', '100.64.9.9, 203.0.113.9, 10.0.0.6')).toBe(
        '203.0.113.9',
      );
    });

    it('falls back to the proxy itself without usable forwarding info', () => {
      expect(service.resolveClientIp('10.0.0.5', undefined)).toBe('10.0.0.5');
      expect(service.resolveClientIp('10.0.0.5', 'garbage, 10.0.0.6')).toBe('10.0.0.5');
    });

    it('normalizes an IPv4-mapped peer address', () => {
      expect(service.resolveClientIp('::ffff:203.0.113.9', undefined)).toBe('203.0.113.9');
    });

    it('returns null when there is no peer address', () => {
      expect(service.resolveClientIp(undefined, '100.64.1.1')).toBeNull();
    });
  });
});
