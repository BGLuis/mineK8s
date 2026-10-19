import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';

export interface MinecraftVersionItem {
  id: string;
  kind: 'release' | 'snapshot';
  releaseTime?: string;
}

const SUPPORTED_SERVER_TYPES = ['VANILLA', 'PAPER', 'PURPUR', 'FABRIC', 'NEOFORGE', 'FORGE'];
const USER_AGENT = 'minek8s-control-plane/1.0 (https://github.com/BGLuis/mineK8s)';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutos
const MAX_CACHE_ENTRIES = 50;

function compareMcVersions(a: string, b: string): number {
  const partsA = a.split(/[-.]/).map((p) => {
    const n = Number(p);
    return Number.isNaN(n) ? p : n;
  });
  const partsB = b.split(/[-.]/).map((p) => {
    const n = Number(p);
    return Number.isNaN(n) ? p : n;
  });
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const pA = partsA[i];
    const pB = partsB[i];
    if (pA === undefined) return -1;
    if (pB === undefined) return 1;
    if (typeof pA === 'number' && typeof pB === 'number') {
      if (pA !== pB) return pB - pA;
    } else {
      const cmp = String(pB).localeCompare(String(pA));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

@Injectable()
export class MinecraftVersionsService {
  private readonly logger = new Logger(MinecraftVersionsService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: MinecraftVersionItem[] }>();

  constructor(private readonly configService: AppConfigService) {}

  async listVersions(
    serverType: string,
    snapshots: boolean = false,
  ): Promise<MinecraftVersionItem[]> {
    const type = (serverType || '').toUpperCase().trim();
    if (!SUPPORTED_SERVER_TYPES.includes(type)) {
      throw new BadRequestException(`Unknown server type "${serverType}"`);
    }

    const allVersions = await this.getAllVersionsForType(type);
    if (snapshots) {
      return allVersions;
    }
    return allVersions.filter((v) => v.kind === 'release');
  }

  async getVersionDirection(
    fromVersion: string,
    toVersion: string,
  ): Promise<'upgrade' | 'downgrade' | 'same'> {
    if (fromVersion === toVersion) {
      return 'same';
    }

    const versions = await this.listVersions('VANILLA', true);
    const from = versions.find((v) => v.id === fromVersion);
    const to = versions.find((v) => v.id === toVersion);

    if (from?.releaseTime && to?.releaseTime) {
      const fromTime = Date.parse(from.releaseTime);
      const toTime = Date.parse(to.releaseTime);
      if (toTime < fromTime) {
        return 'downgrade';
      }
      if (toTime > fromTime) {
        return 'upgrade';
      }
      return 'same';
    }

    const cmp = compareMcVersions(fromVersion, toVersion);
    if (cmp < 0) return 'downgrade';
    if (cmp > 0) return 'upgrade';
    return 'same';
  }

  private async getAllVersionsForType(type: string): Promise<MinecraftVersionItem[]> {
    const cached = this.cache.get(type);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let items: MinecraftVersionItem[];
    switch (type) {
      case 'VANILLA':
        items = await this.fetchVanillaVersions();
        break;
      case 'PAPER':
        items = await this.fetchPaperVersions();
        break;
      case 'PURPUR':
        items = await this.fetchPurpurVersions();
        break;
      case 'FABRIC':
        items = await this.fetchFabricVersions();
        break;
      case 'NEOFORGE':
        items = await this.fetchNeoForgeVersions();
        break;
      case 'FORGE':
        items = await this.fetchForgeVersions();
        break;
      default:
        throw new BadRequestException(`Unknown server type "${type}"`);
    }

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(type, {
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
      value: items,
    });

    return items;
  }

  private async fetchVanillaVersions(): Promise<MinecraftVersionItem[]> {
    const url = this.configService.serverJarSources.mojangManifestUrl;
    const data = await this.getJson<{
      versions: { id: string; type: string; releaseTime: string }[];
    }>(url);

    return data.versions.map((v) => ({
      id: v.id,
      kind: v.type === 'release' ? 'release' : 'snapshot',
      releaseTime: v.releaseTime,
    }));
  }

  private async fetchPaperVersions(): Promise<MinecraftVersionItem[]> {
    const base = `${this.configService.serverJarSources.paperApiUrl}/v3/projects/paper/versions`;
    const data = await this.getJson<{
      versions: { version: { id: string } }[];
    }>(base);

    return data.versions.map((entry) => {
      const id = entry.version.id;
      const isSnapshot = /-rc-|-pre-|snapshot/i.test(id);
      return {
        id,
        kind: isSnapshot ? 'snapshot' : 'release',
      };
    });
  }

  private async fetchPurpurVersions(): Promise<MinecraftVersionItem[]> {
    const base = `${this.configService.serverJarSources.purpurApiUrl}/v2/purpur`;
    const data = await this.getJson<{ versions: string[] }>(base);

    return [...data.versions].reverse().map((id) => ({
      id,
      kind: 'release',
    }));
  }

  private async fetchFabricVersions(): Promise<MinecraftVersionItem[]> {
    const base = `${this.configService.serverJarSources.fabricMetaUrl}/v2/versions/game`;
    const data = await this.getJson<{ version: string; stable: boolean }[]>(base);

    return data.map((v) => ({
      id: v.version,
      kind: v.stable ? 'release' : 'snapshot',
    }));
  }

  private async fetchNeoForgeVersions(): Promise<MinecraftVersionItem[]> {
    const base = `${this.configService.serverJarSources.neoforgeMavenUrl}/api/maven/versions/releases/net/neoforged/neoforge`;
    const data = await this.getJson<{ versions: string[] }>(base);

    const reversed = [...data.versions].reverse();
    const versionMap = new Map<string, { isRelease: boolean }>();

    for (const v of reversed) {
      let mcVersion: string | null = null;
      const match20 = v.match(/^20\.(\d+)/);
      const match21 = v.match(/^21\.(\d+)/);
      const match26 = v.match(/^26\.(\d+)(?:\.(\d+))?/);

      if (match20) {
        mcVersion = `1.20.${match20[1]}`;
      } else if (match21) {
        mcVersion = `1.21.${match21[1]}`;
      } else if (match26) {
        mcVersion =
          match26[2] && match26[2] !== '0' ? `26.${match26[1]}.${match26[2]}` : `26.${match26[1]}`;
      } else {
        const genMatch = v.match(/^(\d+\.\d+(?:\.\d+)?)/);
        if (genMatch) {
          mcVersion = genMatch[1];
        }
      }

      if (!mcVersion) continue;

      const isSnapshot = /alpha|beta|snapshot/i.test(v);
      const existing = versionMap.get(mcVersion);
      if (!existing) {
        versionMap.set(mcVersion, { isRelease: !isSnapshot });
      } else if (!isSnapshot) {
        existing.isRelease = true;
      }
    }

    const items: MinecraftVersionItem[] = [];
    for (const [id, info] of versionMap.entries()) {
      items.push({
        id,
        kind: info.isRelease ? 'release' : 'snapshot',
      });
    }
    return items;
  }

  private async fetchForgeVersions(): Promise<MinecraftVersionItem[]> {
    const base = this.configService.serverJarSources.forgePromotionsUrl;
    const data = await this.getJson<{ promos: Record<string, string> }>(base);

    const mcSet = new Set<string>();
    for (const key of Object.keys(data.promos || {})) {
      const mc = key.replace(/-(latest|recommended)$/, '').trim();
      if (mc) {
        mcSet.add(mc);
      }
    }

    const sorted = Array.from(mcSet).sort(compareMcVersions);
    return sorted.map((id) => ({
      id,
      kind: 'release',
    }));
  }

  private async getJson<T>(url: string): Promise<T> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch from ${url}: ${message}`);
      throw new BadGatewayException(`Failed to fetch from upstream: ${message}`);
    }
  }
}
