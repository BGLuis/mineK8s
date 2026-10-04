import { BlockList, isIP } from 'node:net';
import { Injectable } from '@nestjs/common';

import { AppConfigService } from '@config/app-config.service';

/**
 * Decides which TCP peers may vouch for a client identity. Peers outside AUTH_TRUSTED_PROXY_IPS
 * (empty by default) are never believed: their X-Forwarded-For and X-Tailscale-User are ignored,
 * so a client cannot choose the IP that the Tailscale WhoIs lookup is run against.
 */
@Injectable()
export class TrustedProxyService {
  private readonly trusted = new BlockList();

  constructor(config: AppConfigService) {
    for (const entry of config.authTrustedProxyIps) {
      this.addEntry(entry);
    }
  }

  /** `peer` is the socket address, e.g. `req.socket.remoteAddress`. */
  isTrusted(peer: string | undefined | null): boolean {
    const address = normalizeAddress(peer);
    const family = address ? isIP(address) : 0;
    return family !== 0 && this.trusted.check(address as string, family === 4 ? 'ipv4' : 'ipv6');
  }

  /**
   * The address whose identity is being asked about: the TCP peer, unless it is a trusted proxy,
   * in which case the right-most X-Forwarded-For hop that is not itself a trusted proxy.
   */
  resolveClientIp(
    peer: string | undefined | null,
    forwardedFor: string | string[] | undefined,
  ): string | null {
    const direct = normalizeAddress(peer);
    if (!direct || !this.isTrusted(direct) || !forwardedFor) {
      return direct;
    }
    const hops = [forwardedFor].flat().join(',').split(',').map(normalizeAddress);
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      if (hop && isIP(hop) !== 0 && !this.isTrusted(hop)) {
        return hop;
      }
    }
    return direct;
  }

  private addEntry(entry: string): void {
    const [address, prefix] = entry.split('/');
    const family = isIP(address);
    const valid =
      family !== 0 &&
      (prefix === undefined ||
        (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)));
    if (!valid) {
      throw new Error(`Invalid AUTH_TRUSTED_PROXY_IPS entry "${entry}": expected an IP or CIDR`);
    }
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      this.trusted.addAddress(address, type);
    } else {
      this.trusted.addSubnet(address, Number(prefix), type);
    }
  }
}

function normalizeAddress(raw: string | undefined | null): string | null {
  const address = raw?.trim().replace(/^::ffff:/i, '');
  return address ? address : null;
}
