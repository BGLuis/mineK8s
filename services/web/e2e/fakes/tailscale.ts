import * as fs from 'node:fs';
import * as http from 'node:http';

import { ADMIN_TAILSCALE } from '../env';

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * tailscaled LocalAPI on a Unix socket (TAILSCALE_SOCKET_PATH). Every address belongs to the admin's
 * untagged laptop: the bootstrap links that identity and the VPN login resolves it again.
 */
export function startLocalApi(socketPath: string): Promise<http.Server> {
  fs.rmSync(socketPath, { force: true });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local-tailscaled.sock');
    if (url.pathname === '/localapi/v0/status') {
      return json(res, 200, { BackendState: 'Running' });
    }
    if (url.pathname === '/localapi/v0/whois') {
      return json(res, 200, {
        Node: {
          ID: 1,
          StableID: 'nE2EAdminLaptop',
          Name: `${ADMIN_TAILSCALE.nodeName}.e2e.ts.net.`,
          User: ADMIN_TAILSCALE.userId,
          Addresses: ['100.64.0.10/32'],
          Tags: [],
        },
        UserProfile: {
          ID: ADMIN_TAILSCALE.userId,
          LoginName: ADMIN_TAILSCALE.loginName,
          DisplayName: 'Admin E2E',
        },
      });
    }
    json(res, 404, { error: `no fake for ${url.pathname}` });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}

/** Tailscale Cloud API (TAILSCALE_API_URL): only the pre-auth key that an invite claim asks for. */
export function startCloudApi(port: number): Promise<http.Server> {
  let issued = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /^\/api\/v2\/tailnet\/[^/]+\/keys$/.test(req.url ?? '')) {
      issued += 1;
      return json(res, 200, {
        id: `kE2E${issued}`,
        key: `tskey-auth-e2e-${issued}`,
        expires: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        capabilities: {},
      });
    }
    json(res, 404, { message: `no fake for ${req.method} ${req.url}` });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
