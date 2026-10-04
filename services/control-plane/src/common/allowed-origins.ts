/**
 * Origin policy shared by every Socket.IO namespace. A request without an Origin header is not a
 * browser (CLI, the Rust gateway), so CORS has nothing to say about it; authentication still applies.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return origin === undefined || allowedOrigins.includes(origin);
}
