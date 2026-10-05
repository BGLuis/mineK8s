import { isIP } from 'node:net';

/**
 * The IP inside a client address as sockets, proxies and the gateway report it: `ip`, `ipv4:port`, `[ipv6]:port`,
 * or IPv4 mapped into IPv6. Splitting on the first ':' would cut an IPv6 address down to its first group.
 * Returns null when no IP can be read from it.
 */
export function parseClientAddress(raw: string): string | null {
  let address = raw.trim();

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) {
    address = bracketed[1];
  } else if (/^[^:]+:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(':'));
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) {
    address = mapped[1];
  }

  return isIP(address) !== 0 ? address : null;
}
