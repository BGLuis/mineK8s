import { isTailscaleDeepLink, maskAuthKey } from './auth-key';

describe('maskAuthKey', () => {
  it('keeps the recognisable head and tail and hides the middle', () => {
    const key = 'tskey-auth-k8FqAbCdEfGhIjKl92xZ';
    const masked = maskAuthKey(key);
    expect(masked).toBe('tskey-auth-k8Fq…92xZ');
    expect(masked).not.toContain('AbCdEf');
  });

  it('does not pretend to hide a key too short to mask', () => {
    expect(maskAuthKey('short')).toBe('short');
  });
});

describe('isTailscaleDeepLink', () => {
  it('only follows the tailscale scheme', () => {
    expect(isTailscaleDeepLink('tailscale://login?key=abc')).toBe(true);
    expect(isTailscaleDeepLink('https://evil.example/login')).toBe(false);
    expect(isTailscaleDeepLink('javascript:alert(1)')).toBe(false);
  });
});
