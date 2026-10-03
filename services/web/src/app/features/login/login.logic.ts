const DEFAULT_TARGET = '/';

/**
 * The `redirect` query param is user-controlled, so only in-app paths are followed.
 * Absolute URLs, protocol-relative ("//host") and backslash tricks fall back to the dashboard,
 * and so does /login itself (it would loop).
 */
export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return DEFAULT_TARGET;
  }
  const path = raw.split(/[?#]/, 1)[0];
  return path === '/login' ? DEFAULT_TARGET : raw;
}
