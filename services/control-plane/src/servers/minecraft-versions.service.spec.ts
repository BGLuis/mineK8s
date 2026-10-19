import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { MinecraftVersionsService } from './minecraft-versions.service';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'runtime', 'fixtures', name), 'utf8');

const MOJANG_URL = 'https://meta.test/mc/game/version_manifest_v2.json';
const PAPER_URL = 'https://fill.test';
const PURPUR_URL = 'https://purpur.test';
const FABRIC_URL = 'https://fabric.test';
const NEOFORGE_URL = 'https://neoforge.test';
const FORGE_URL = 'https://forge.test/promotions_slim.json';

describe('MinecraftVersionsService', () => {
  let service: MinecraftVersionsService;
  let routes: Map<string, { status: number; body: string }>;
  let fetchMock: jest.Mock;

  const mockConfigService = {
    serverJarSources: {
      mojangManifestUrl: MOJANG_URL,
      paperApiUrl: PAPER_URL,
      purpurApiUrl: PURPUR_URL,
      fabricMetaUrl: FABRIC_URL,
      neoforgeMavenUrl: NEOFORGE_URL,
      forgePromotionsUrl: FORGE_URL,
    },
  } as unknown as AppConfigService;

  beforeEach(() => {
    routes = new Map();

    routes.set(MOJANG_URL, {
      status: 200,
      body: fixture('mojang-version-manifest-v2.json'),
    });

    routes.set(`${PAPER_URL}/v3/projects/paper/versions`, {
      status: 200,
      body: JSON.stringify({
        versions: [
          { version: { id: '26.3' } },
          { version: { id: '26.4-pre-1' } },
          { version: { id: '1.21.1' } },
        ],
      }),
    });

    routes.set(`${PURPUR_URL}/v2/purpur`, {
      status: 200,
      body: JSON.stringify({
        versions: ['1.20.4', '1.21.1', '26.3'],
      }),
    });

    routes.set(`${FABRIC_URL}/v2/versions/game`, {
      status: 200,
      body: JSON.stringify([
        { version: '26.4-snapshot-4', stable: false },
        { version: '26.3', stable: true },
        { version: '1.21.1', stable: true },
      ]),
    });

    routes.set(`${NEOFORGE_URL}/api/maven/versions/releases/net/neoforged/neoforge`, {
      status: 200,
      body: JSON.stringify({
        versions: ['20.2.1-beta', '20.2.88', '21.1.1-beta', '21.1.45', '26.3.0.92'],
      }),
    });

    routes.set(FORGE_URL, {
      status: 200,
      body: JSON.stringify({
        promos: {
          '1.20.4-latest': '49.0.30',
          '1.20.4-recommended': '49.0.30',
          '1.21.1-latest': '52.0.1',
          '1.19.4-latest': '45.2.0',
        },
      }),
    });

    fetchMock = jest.fn(async (url: string) => {
      const match = routes.get(url);
      if (!match) {
        return new Response('{"error":"not found"}', { status: 404 });
      }
      return new Response(match.body, { status: match.status });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    service = new MinecraftVersionsService(mockConfigService);
  });

  describe('VANILLA', () => {
    it('returns only releases newest first when snapshots is false', async () => {
      const versions = await service.listVersions('VANILLA', false);

      expect(versions.length).toBeGreaterThan(0);
      expect(versions.every((v) => v.kind === 'release')).toBe(true);
      expect(versions[0].id).toBe('26.3');
      expect(versions[1].id).toBe('26.1');
      expect(versions.find((v) => v.id === '1.21.1')).toBeDefined();
      expect(versions.find((v) => v.id === '26.4-snapshot-4')).toBeUndefined();
    });

    it('includes snapshots when snapshots is true (#202)', async () => {
      const versions = await service.listVersions('VANILLA', true);

      expect(versions.find((v) => v.id === '26.4-snapshot-4')).toBeDefined();
      const snapshotItem = versions.find((v) => v.id === '26.4-snapshot-4');
      expect(snapshotItem?.kind).toBe('snapshot');
    });

    it('does not make a second HTTP request within TTL (#202)', async () => {
      await service.listVersions('VANILLA', false);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await service.listVersions('VANILLA', true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('PAPER', () => {
    it('parses Paper versions and categorizes snapshots', async () => {
      const all = await service.listVersions('PAPER', true);
      expect(all.map((v) => ({ id: v.id, kind: v.kind }))).toEqual([
        { id: '26.3', kind: 'release' },
        { id: '26.4-pre-1', kind: 'snapshot' },
        { id: '1.21.1', kind: 'release' },
      ]);

      const releasesOnly = await service.listVersions('PAPER', false);
      expect(releasesOnly.map((v) => v.id)).toEqual(['26.3', '1.21.1']);
    });
  });

  describe('PURPUR', () => {
    it('returns purpur versions reversed as releases', async () => {
      const releases = await service.listVersions('PURPUR', false);
      expect(releases.map((v) => v.id)).toEqual(['26.3', '1.21.1', '1.20.4']);
    });
  });

  describe('FABRIC', () => {
    it('maps Fabric versions and honors stable flag', async () => {
      const all = await service.listVersions('FABRIC', true);
      expect(all).toEqual([
        { id: '26.4-snapshot-4', kind: 'snapshot' },
        { id: '26.3', kind: 'release' },
        { id: '1.21.1', kind: 'release' },
      ]);
    });
  });

  describe('NEOFORGE', () => {
    it('maps NeoForge versions and transforms prefix', async () => {
      const versions = await service.listVersions('NEOFORGE', false);
      expect(versions.map((v) => v.id)).toEqual(['26.3', '1.21.1', '1.20.2']);
    });
  });

  describe('FORGE', () => {
    it('extracts unique MC versions and sorts descending', async () => {
      const versions = await service.listVersions('FORGE', false);
      expect(versions.map((v) => v.id)).toEqual(['1.21.1', '1.20.4', '1.19.4']);
    });
  });

  describe('getVersionDirection (#203)', () => {
    it('classifies 1.21.11 -> 26.1 as upgrade using manifest releaseTime', async () => {
      const direction = await service.getVersionDirection('1.21.11', '26.1');
      expect(direction).toBe('upgrade');
    });

    it('classifies 26.3 -> 1.21.11 as downgrade using manifest releaseTime', async () => {
      const direction = await service.getVersionDirection('26.3', '1.21.11');
      expect(direction).toBe('downgrade');
    });

    it('returns same when versions are equal', async () => {
      const direction = await service.getVersionDirection('26.3', '26.3');
      expect(direction).toBe('same');
    });

    it('classifies unlisted 99.1 -> 99.1.1 as upgrade using compareMcVersions fallback', async () => {
      const direction = await service.getVersionDirection('99.1', '99.1.1');
      expect(direction).toBe('upgrade');
    });

    it('classifies unlisted 99.1.1 -> 99.1 as downgrade using compareMcVersions fallback', async () => {
      const direction = await service.getVersionDirection('99.1.1', '99.1');
      expect(direction).toBe('downgrade');
    });
  });

  describe('error handling', () => {
    it('rejects unknown server type with BadRequestException', async () => {
      await expect(service.listVersions('UNKNOWN', false)).rejects.toThrow(BadRequestException);
    });

    it('throws BadGatewayException when upstream fails', async () => {
      routes.set(MOJANG_URL, { status: 500, body: 'Internal Error' });
      const fresh = new MinecraftVersionsService(mockConfigService);
      await expect(fresh.listVersions('VANILLA', false)).rejects.toThrow(BadGatewayException);
    });
  });
});
