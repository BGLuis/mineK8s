import { isOriginAllowed } from './allowed-origins';

describe('isOriginAllowed (#92)', () => {
  const allowed = ['http://localhost:4200', 'https://panel.example.net'];

  it('accepts only the configured origins, compared exactly', () => {
    expect(isOriginAllowed('http://localhost:4200', allowed)).toBe(true);
    expect(isOriginAllowed('https://panel.example.net', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:4200.evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:4201', allowed)).toBe(false);
  });

  it('refuses the opaque "null" origin sent by sandboxed pages', () => {
    expect(isOriginAllowed('null', allowed)).toBe(false);
  });

  it('lets through requests without an Origin header, which are not browsers', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it('allows no browser at all when nothing is configured', () => {
    expect(isOriginAllowed('http://localhost:4200', [])).toBe(false);
  });
});
