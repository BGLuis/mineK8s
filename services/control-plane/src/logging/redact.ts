// Sensitive keys that must be redacted from request/response bodies and logs
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'rcon_password',
  'rconpassword',
  'secret',
  'token',
  'apikey',
  'authorization',
  'key',
]);

// Settings bodies nest their values under dotted keys such as `cloudflare.apiToken`.
const SENSITIVE_SUFFIXES = ['apikey', 'token', 'password', 'secret'];
const MAX_DEPTH = 4;

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_BODY_KEYS.has(lower) || SENSITIVE_SUFFIXES.some((s) => lower.endsWith(s));
}

export function redactBody(body: unknown, depth = 0): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  if (depth > MAX_DEPTH) {
    return '[Truncated]';
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = isSensitive(k) ? '[Redacted]' : redactBody(v, depth + 1);
  }
  return out;
}
