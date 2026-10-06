import { createHash } from 'node:crypto';
import * as http from 'node:http';

/**
 * Mojang piston-meta (MOJANG_VERSION_MANIFEST_URL): the v2 manifest and the 1.21.1 document the control plane reads
 * to resolve a Vanilla server's jar and Java version. The jar itself is never fetched, since the k8s driver is mocked.
 */
export function startMojangMeta(port: number): Promise<http.Server> {
  const base = `http://127.0.0.1:${port}`;
  const version = JSON.stringify({
    id: '1.21.1',
    javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
    downloads: {
      server: {
        sha1: '59353fb40c36d304f2035d51e7d6e6baa98dc05c',
        size: 51627615,
        url: 'https://piston-data.mojang.com/v1/objects/59353fb40c36d304f2035d51e7d6e6baa98dc05c/server.jar',
      },
    },
  });
  const manifest = JSON.stringify({
    versions: [
      {
        id: '1.21.1',
        type: 'release',
        url: `${base}/v1/packages/1.21.1.json`,
        sha1: createHash('sha1').update(version).digest('hex'),
      },
    ],
  });

  const server = http.createServer((req, res) => {
    const body =
      req.url === '/mc/game/version_manifest_v2.json'
        ? manifest
        : req.url === '/v1/packages/1.21.1.json'
          ? version
          : undefined;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(body ?? JSON.stringify({ error: `no fake for ${req.url}` }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
