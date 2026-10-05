import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { CurseForgeResolverService } from './resolvers/curseforge-resolver.service';
import {
  ModpackSearchResponseDto,
  ModpackVersionDto,
  UniversalModpackDto,
} from './dto/universal-modpack.dto';

export type CatalogSource = 'modrinth' | 'curseforge';
export type CatalogSort = 'relevance' | 'downloads' | 'updated';
export type CatalogLoader = 'neoforge' | 'fabric' | 'quilt' | 'forge';

export const CATALOG_SORTS: readonly CatalogSort[] = ['relevance', 'downloads', 'updated'];
export const CATALOG_LOADERS: readonly CatalogLoader[] = ['neoforge', 'fabric', 'quilt', 'forge'];

export interface CatalogFilters {
  gameVersion?: string;
  loader?: CatalogLoader;
  category?: string;
}

const MODRINTH_API = 'https://api.modrinth.com/v2';
const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const CURSEFORGE_GAME_ID_MINECRAFT = 432;
const CURSEFORGE_CLASS_ID_MODPACKS = 4471;
const CURSEFORGE_SORT_FIELD: Record<CatalogSort, number> = {
  relevance: 2,
  updated: 3,
  downloads: 6,
};
const CURSEFORGE_LOADER_TYPE: Record<CatalogLoader, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};
const CURSEFORGE_MAX_WINDOW = 10000;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_CACHE_ENTRIES = 200;
const USER_AGENT = 'BGLuis/mineK8s (control-plane modpack catalog)';

const LOADERS: readonly string[] = CATALOG_LOADERS;
const CURSEFORGE_LOADER_BY_ID: Record<number, string> = {
  1: 'forge',
  4: 'fabric',
  5: 'quilt',
  6: 'neoforge',
};
const CURSEFORGE_RELEASE_TYPE: Record<number, string> = { 1: 'release', 2: 'beta', 3: 'alpha' };

interface SourcePage {
  total: number;
  results: UniversalModpackDto[];
}

@Injectable()
export class ModpackCatalogService {
  private readonly logger = new Logger(ModpackCatalogService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly configService: AppConfigService,
    private readonly curseForge: CurseForgeResolverService,
  ) {}

  /**
   * Busca nas fontes ativas. Com duas fontes a página é dividida entre elas, então
   * `offset` deve avançar de `limit` em `limit` e `limit` deve ser par para não perder itens.
   */
  public async search(
    params: {
      query?: string;
      source?: CatalogSource;
      offset?: number;
      limit?: number;
      sort?: CatalogSort;
    } & CatalogFilters,
  ): Promise<ModpackSearchResponseDto> {
    const query = (params.query || '').trim();
    const limit = this.clamp(params.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    const offset = this.clamp(params.offset, 0, Number.MAX_SAFE_INTEGER, 0);

    const wanted: CatalogSource[] = params.source ? [params.source] : ['modrinth', 'curseforge'];
    const usable = wanted.filter((s) => s !== 'curseforge' || this.curseForge.getApiKey());
    if (usable.length === 0) {
      throw new ServiceUnavailableException(
        'CurseForge API key não configurada (CURSEFORGE_API_KEY).',
      );
    }

    const sort = params.sort ?? 'relevance';
    const filters: CatalogFilters = {
      gameVersion: params.gameVersion,
      loader: params.loader,
      category: params.category,
    };
    const perSourceLimit = Math.ceil(limit / usable.length);
    const perSourceOffset = Math.floor(offset / usable.length);

    const settled = await Promise.allSettled(
      usable.map((s) =>
        s === 'modrinth'
          ? this.searchModrinth(query, perSourceOffset, perSourceLimit, sort, filters)
          : this.searchCurseForge(query, perSourceOffset, perSourceLimit, sort, filters),
      ),
    );

    const pages: SourcePage[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        pages.push(outcome.value);
      } else {
        this.logger.warn(`Busca de modpacks falhou em ${usable[i]}: ${outcome.reason?.message}`);
      }
    });
    if (pages.length === 0) {
      throw new BadGatewayException('Nenhum catálogo de modpacks respondeu.');
    }

    const results = this.mergePages(pages, sort).slice(0, limit);

    return { total: pages.reduce((sum, p) => sum + p.total, 0), offset, limit, results };
  }

  public async getVersions(id: string, source?: CatalogSource): Promise<ModpackVersionDto[]> {
    const resolved: CatalogSource = source ?? (/^\d+$/.test(id) ? 'curseforge' : 'modrinth');
    try {
      return resolved === 'modrinth'
        ? await this.modrinthVersions(id)
        : await this.curseForgeVersions(id);
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.warn(`Listagem de versões falhou em ${resolved} para ${id}: ${err.message}`);
      throw new BadGatewayException(`Falha ao consultar versões em ${resolved}.`);
    }
  }

  /**
   * Cada fonte entrega a página já ordenada pelo seu próprio critério. Entre fontes só `downloads` e
   * `updated` são comparáveis; em `relevance` as páginas são intercaladas para não favorecer uma fonte.
   */
  private mergePages(pages: SourcePage[], sort: CatalogSort): UniversalModpackDto[] {
    if (sort === 'downloads') {
      return pages.flatMap((p) => p.results).sort((a, b) => b.downloads - a.downloads);
    }
    if (sort === 'updated') {
      const time = (m: UniversalModpackDto) => m.dateModified?.getTime() ?? 0;
      return pages.flatMap((p) => p.results).sort((a, b) => time(b) - time(a));
    }
    const merged: UniversalModpackDto[] = [];
    const longest = Math.max(...pages.map((p) => p.results.length));
    for (let i = 0; i < longest; i++) {
      for (const page of pages) {
        if (i < page.results.length) merged.push(page.results[i]);
      }
    }
    return merged;
  }

  private async searchModrinth(
    query: string,
    offset: number,
    limit: number,
    sort: CatalogSort,
    filters: CatalogFilters,
  ): Promise<SourcePage> {
    const url = new URL(`${MODRINTH_API}/search`);
    if (query) url.searchParams.set('query', query);
    // No Modrinth os loaders são categorias; cada array interno é um AND.
    const facets = [['project_type:modpack']];
    if (filters.gameVersion) facets.push([`versions:${filters.gameVersion}`]);
    if (filters.loader) facets.push([`categories:${filters.loader}`]);
    if (filters.category) facets.push([`categories:${filters.category}`]);
    url.searchParams.set('facets', JSON.stringify(facets));
    url.searchParams.set('index', sort);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));

    const body = await this.getJson<any>(url.toString(), { 'User-Agent': USER_AGENT });
    const results: UniversalModpackDto[] = (body.hits ?? []).map((hit: any) => ({
      id: hit.project_id,
      name: hit.title,
      summary: hit.description ?? '',
      source: 'MODRINTH',
      author: hit.author,
      iconUrl: hit.icon_url || undefined,
      downloads: hit.downloads ?? 0,
      gameVersion: hit.versions?.[hit.versions.length - 1],
      loader: LOADERS.find((l) => hit.categories?.includes(l)),
      dateModified: hit.date_modified ? new Date(hit.date_modified) : undefined,
    }));
    return { total: body.total_hits ?? results.length, results };
  }

  private async searchCurseForge(
    query: string,
    offset: number,
    limit: number,
    sort: CatalogSort,
    filters: CatalogFilters,
  ): Promise<SourcePage> {
    const pageSize = Math.min(limit, Math.max(0, CURSEFORGE_MAX_WINDOW - offset));
    if (pageSize === 0) return { total: 0, results: [] };

    let categoryId: number | undefined;
    if (filters.category) {
      categoryId = await this.curseForgeCategoryId(filters.category);
      if (categoryId === undefined) return { total: 0, results: [] };
    }

    const url = new URL(`${CURSEFORGE_API}/mods/search`);
    url.searchParams.set('gameId', String(CURSEFORGE_GAME_ID_MINECRAFT));
    url.searchParams.set('classId', String(CURSEFORGE_CLASS_ID_MODPACKS));
    if (query) url.searchParams.set('searchFilter', query);
    if (filters.gameVersion) url.searchParams.set('gameVersion', filters.gameVersion);
    if (filters.loader) {
      url.searchParams.set('modLoaderType', String(CURSEFORGE_LOADER_TYPE[filters.loader]));
    }
    if (categoryId !== undefined) url.searchParams.set('categoryId', String(categoryId));
    url.searchParams.set('sortField', String(CURSEFORGE_SORT_FIELD[sort]));
    url.searchParams.set('sortOrder', 'desc');
    url.searchParams.set('index', String(offset));
    url.searchParams.set('pageSize', String(pageSize));

    const body = await this.getJson<any>(url.toString(), this.curseForgeHeaders());
    const results: UniversalModpackDto[] = (body.data ?? []).map((mod: any) => {
      const latest = mod.latestFilesIndexes?.[0];
      return {
        id: String(mod.id),
        name: mod.name,
        summary: mod.summary ?? '',
        source: 'CURSEFORGE',
        author: mod.authors?.[0]?.name,
        iconUrl: mod.logo?.url || undefined,
        downloads: mod.downloadCount ?? 0,
        gameVersion: latest?.gameVersion,
        loader: latest ? CURSEFORGE_LOADER_BY_ID[latest.modLoader] : undefined,
        dateModified: mod.dateModified ? new Date(mod.dateModified) : undefined,
      };
    });
    return { total: body.pagination?.totalCount ?? results.length, results };
  }

  /** Categorias não têm id comum entre as fontes; o slug (ex.: `adventure`) é o elo. */
  private async curseForgeCategoryId(slug: string): Promise<number | undefined> {
    const url = `${CURSEFORGE_API}/categories?gameId=${CURSEFORGE_GAME_ID_MINECRAFT}&classId=${CURSEFORGE_CLASS_ID_MODPACKS}`;
    const body = await this.getJson<any>(url, this.curseForgeHeaders());
    return (body.data ?? []).find((c: any) => c.slug === slug)?.id;
  }

  private async modrinthVersions(projectId: string): Promise<ModpackVersionDto[]> {
    const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`;
    const body = await this.getJson<any[]>(url, { 'User-Agent': USER_AGENT });
    return body.map((v) => {
      const file = v.files?.find((f: any) => f.primary) ?? v.files?.[0];
      return {
        id: v.id,
        name: v.name || v.version_number,
        gameVersion: v.game_versions?.[v.game_versions.length - 1] ?? '',
        loader: LOADERS.find((l) => v.loaders?.includes(l)) ?? v.loaders?.[0] ?? '',
        releaseType: v.version_type,
        datePublished: new Date(v.date_published),
        downloadUrl: file?.url,
      };
    });
  }

  private async curseForgeVersions(modId: string): Promise<ModpackVersionDto[]> {
    if (!this.curseForge.getApiKey()) {
      throw new ServiceUnavailableException(
        'CurseForge API key não configurada (CURSEFORGE_API_KEY).',
      );
    }
    const url = `${CURSEFORGE_API}/mods/${encodeURIComponent(modId)}/files?pageSize=${MAX_PAGE_SIZE}`;
    const body = await this.getJson<any>(url, this.curseForgeHeaders());
    return (body.data ?? []).map((f: any) => {
      const tags: string[] = f.gameVersions ?? [];
      return {
        id: String(f.id),
        name: f.displayName || f.fileName,
        gameVersion: tags.find((t) => /^\d+\.\d+/.test(t)) ?? '',
        loader: LOADERS.find((l) => tags.some((t) => t.toLowerCase() === l)) ?? '',
        releaseType: CURSEFORGE_RELEASE_TYPE[f.releaseType] ?? 'release',
        datePublished: new Date(f.fileDate),
        downloadUrl: f.downloadUrl || undefined,
      };
    });
  }

  private curseForgeHeaders(): Record<string, string> {
    return { 'x-api-key': this.curseForge.getApiKey(), Accept: 'application/json' };
  }

  private async getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    // A chave fica fora da cache key: trocar a chave não muda o conteúdo do catálogo.
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const { cacheTtlMs, requestTimeoutMs } = this.configService.modpackCatalog;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
    const value = (await res.json()) as T;

    if (cacheTtlMs > 0) {
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(url, { expiresAt: Date.now() + cacheTtlMs, value });
    }
    return value;
  }

  private clamp(value: unknown, min: number, max: number, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }
}
