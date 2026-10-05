import { safeRedirect } from './login.logic';

describe('safeRedirect', () => {
  it('goes to the dashboard when there is no redirect', () => {
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
    expect(safeRedirect('')).toBe('/');
  });

  it('keeps in-app paths, including query strings', () => {
    expect(safeRedirect('/access')).toBe('/access');
    expect(safeRedirect('/servers/abc/console?tab=logs')).toBe('/servers/abc/console?tab=logs');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'access',
  ])('refuses to leave the app: %s', (target) => {
    expect(safeRedirect(target)).toBe('/');
  });

  it('does not bounce back to the login screen', () => {
    expect(safeRedirect('/login')).toBe('/');
    expect(safeRedirect('/login?redirect=/access')).toBe('/');
  });
});
