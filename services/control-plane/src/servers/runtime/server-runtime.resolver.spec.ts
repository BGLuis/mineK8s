import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadGatewayException, BadRequestException } from '@nestjs/common';

import { ServerRuntimeResolver } from './server-runtime.resolver';

/**
 * The fixtures are trimmed copies of the real responses (2026-10-05). Trimming changes the Mojang version documents,
 * so the sha1 of each manifest entry was recomputed over the trimmed file.
 */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const MANIFEST_URL = 'https://meta.test/mc/game/version_manifest_v2.json';
const PAPER_API = 'https://fill.test';
const PURPUR_API = 'https://purpur.test';

describe('ServerRuntimeResolver', () => {
  const originalFetch = global.fetch;
  let routes: Map<string, string>;
  let fetchMock: jest.Mock;
  let resolver: ServerRuntimeResolver;

  const serve = (url: string, body: string) => routes.set(url, body);
  const mojangUrl = (version: string) => {
    const manifest = JSON.parse(routes.get(MANIFEST_URL)!);
    return manifest.versions.find((v: any) => v.id === version).url as string;
  };

  beforeEach(() => {
    routes = new Map();
    serve(MANIFEST_URL, fixture('mojang-version-manifest-v2.json'));
    for (const version of ['26.3', '1.21.1', '1.20.4', '1.17.1', '1.16.5', '1.0']) {
      serve(mojangUrl(version), fixture(`mojang-${version}.json`));
    }
    for (const version of ['1.21.11', '26.3']) {
      const base = `${PAPER_API}/v3/projects/paper/versions/${version}`;
      serve(base, fixture(`paper-${version}.json`));
      serve(`${base}/builds`, fixture(`paper-${version}-builds.json`));
    }
    serve(`${PURPUR_API}/v2/purpur/1.21.1/latest`, fixture('purpur-1.21.1-latest.json'));

    fetchMock = jest.fn(async (url: string) => {
      const body = routes.get(url);
      return body === undefined
        ? new Response('{"error":"version not found"}', { status: 404 })
        : new Response(body, { status: 200 });
    });
    global.fetch = fetchMock as any;

    resolver = new ServerRuntimeResolver({
      serverJarSources: {
        mojangManifestUrl: MANIFEST_URL,
        paperApiUrl: PAPER_API,
        purpurApiUrl: PURPUR_API,
      },
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Vanilla (#154)', () => {
    it('takes the server jar and its sha1 from the version document the v2 manifest points at', async () => {
      await expect(resolver.resolve('VANILLA', '1.21.1')).resolves.toEqual({
        java_version: 21,
        server_jar_url:
          'https://piston-data.mojang.com/v1/objects/59353fb40c36d304f2035d51e7d6e6baa98dc05c/server.jar',
        server_jar_checksum: 'sha1:59353fb40c36d304f2035d51e7d6e6baa98dc05c',
        server_build: null,
        server_build_channel: null,
      });
    });

    it('refuses a version without a dedicated server jar', async () => {
      await expect(resolver.resolve('VANILLA', '1.0')).rejects.toThrow(
        new BadRequestException('Minecraft 1.0 has no dedicated server jar'),
      );
    });

    it('refuses a version Mojang does not publish', async () => {
      await expect(resolver.resolve('VANILLA', '1.99.9')).rejects.toThrow(BadRequestException);
    });

    it('rejects a version document whose sha1 differs from the manifest', async () => {
      serve(
        mojangUrl('1.21.1'),
        fixture('mojang-1.21.1.json').replace('"majorVersion": 21', '"majorVersion": 8'),
      );

      await expect(resolver.resolve('VANILLA', '1.21.1')).rejects.toThrow(BadGatewayException);
    });
  });

  describe('runner Java (#156)', () => {
    it.each([
      ['26.3', 25],
      ['1.21.1', 21],
      ['1.20.4', 17],
      ['1.17.1', 17],
      ['1.16.5', 8],
    ])(
      'Vanilla %s runs on the smallest image that meets the Java Mojang asks for (%i)',
      async (version, java) => {
        expect((await resolver.resolve('VANILLA', version)).java_version).toBe(java);
      },
    );

    it('Forge 1.16.5 gets Java 8, which old Forge needs, and no jar from here', async () => {
      await expect(resolver.resolve('FORGE', '1.16.5')).resolves.toEqual({
        java_version: 8,
        server_jar_url: null,
        server_jar_checksum: null,
        server_build: null,
        server_build_channel: null,
      });
    });

    it('takes the Paper minimum from Fill v3, not from Mojang', async () => {
      const paperMeta = JSON.parse(fixture('paper-1.21.11.json'));
      paperMeta.version.java.version.minimum = 17;
      serve(`${PAPER_API}/v3/projects/paper/versions/1.21.11`, JSON.stringify(paperMeta));

      expect((await resolver.resolve('PAPER', '1.21.11')).java_version).toBe(17);
    });

    it('refuses a version that needs a Java without a runner image', async () => {
      const doc = JSON.parse(fixture('mojang-26.3.json'));
      doc.javaVersion.majorVersion = 27;
      const body = JSON.stringify(doc);
      const manifest = JSON.parse(routes.get(MANIFEST_URL)!);
      const entry = manifest.versions.find((v: any) => v.id === '26.3');
      entry.sha1 = createHash('sha1').update(body).digest('hex');
      serve(MANIFEST_URL, JSON.stringify(manifest));
      serve(entry.url, body);

      await expect(resolver.resolve('VANILLA', '26.3')).rejects.toThrow(
        new BadRequestException(
          'Minecraft 26.3 needs Java 27, and the newest runner image has Java 25',
        ),
      );
    });
  });

  describe('Paper (#157)', () => {
    it('picks the newest STABLE build and its sha256', async () => {
      await expect(resolver.resolve('PAPER', '1.21.11')).resolves.toEqual({
        java_version: 21,
        server_jar_url:
          'https://fill-data.papermc.io/v1/objects/5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba/paper-1.21.11-132.jar',
        server_jar_checksum:
          'sha256:5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba',
        server_build: '132',
        server_build_channel: 'STABLE',
      });
    });

    it('ignores ALPHA and BETA builds newer than the last STABLE one, whatever the list order', async () => {
      const builds = JSON.parse(fixture('paper-1.21.11-builds.json'));
      const beta = builds.find((b: any) => b.channel === 'BETA');
      const newer = [
        { ...beta, id: 140 },
        { ...beta, id: 141, channel: 'ALPHA' },
      ];
      serve(
        `${PAPER_API}/v3/projects/paper/versions/1.21.11/builds`,
        JSON.stringify([...builds.reverse(), ...newer]),
      );

      const runtime = await resolver.resolve('PAPER', '1.21.11');

      expect(runtime.server_build).toBe('132');
      expect(runtime.server_build_channel).toBe('STABLE');
    });

    it('refuses a version that only has experimental builds', async () => {
      await expect(resolver.resolve('PAPER', '26.3')).rejects.toThrow(
        new BadRequestException(
          'Paper has no STABLE build for Minecraft 26.3 yet, only experimental (ALPHA/BETA) ones',
        ),
      );
    });

    it('refuses a version Paper does not have', async () => {
      await expect(resolver.resolve('PAPER', '1.99.9')).rejects.toThrow(
        new BadRequestException('Paper has no builds for Minecraft 1.99.9'),
      );
    });
  });

  describe('Purpur', () => {
    it('pins the latest build by number, with its md5 and the Java Mojang asks for', async () => {
      await expect(resolver.resolve('PURPUR', '1.21.1')).resolves.toEqual({
        java_version: 21,
        server_jar_url: `${PURPUR_API}/v2/purpur/1.21.1/2329/download`,
        server_jar_checksum: 'md5:dc0026462cac76c869335feb43388a76',
        server_build: '2329',
        server_build_channel: null,
      });
    });
  });

  it.each(['1.20.4; rm -rf /data', '$(id)', '../../etc', '', '1.20.4&x=1', '1'])(
    'rejects game_version "%s" before building any URL with it',
    async (version) => {
      await expect(resolver.resolve('PAPER', version)).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('refuses an unknown server type', async () => {
    await expect(resolver.resolve('SPIGOT', '1.21.1')).rejects.toThrow(BadRequestException);
  });

  it('reports an unreachable upstream as a bad gateway, not as a bad request', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(resolver.resolve('VANILLA', '1.21.1')).rejects.toThrow(BadGatewayException);
  });
});
