import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ModpackCatalogService } from './modpack-catalog.service';

const modrinthHit = (id: string, downloads: number, extra: object = {}) => ({
  project_id: id,
  title: `mr-${id}`,
  description: 'desc',
  author: 'alice',
  icon_url: 'https://cdn.modrinth.com/icon.png',
  downloads,
  versions: ['1.19.2', '1.20.1'],
  categories: ['adventure', 'fabric'],
  date_modified: '2026-03-01T10:00:00Z',
  ...extra,
});

const curseForgeMod = (id: number, downloadCount: number) => ({
  id,
  name: `cf-${id}`,
  summary: 'desc',
  authors: [{ name: 'bob' }],
  logo: { url: 'https://media.forgecdn.net/logo.png' },
  downloadCount,
  dateModified: '2026-04-01T10:00:00Z',
  latestFilesIndexes: [{ gameVersion: '1.20.1', modLoader: 1 }],
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe('ModpackCatalogService (RF-ARQ-18)', () => {
  let fetchMock: jest.Mock;
  let apiKey: string;
  let ttl: number;
  let service: ModpackCatalogService;
  const originalFetch = global.fetch;

  const routes = (handlers: { modrinth?: () => any; curseforge?: () => any }) =>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('api.modrinth.com')) return (handlers.modrinth ?? (() => ok({})))();
      if (url.includes('api.curseforge.com')) return (handlers.curseforge ?? (() => ok({})))();
      throw new Error(`unexpected url ${url}`);
    });

  const urlsCalled = (host: string) =>
    fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes(host));

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    apiKey = 'cf-key';
    ttl = 60000;
    const config = {
      get modpackCatalog() {
        return { cacheTtlMs: ttl, requestTimeoutMs: 1000 };
      },
    };
    const curseForge = { getApiKey: () => apiKey };
    service = new ModpackCatalogService(config as any, curseForge as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('search', () => {
    it('mescla as duas fontes ordenando por downloads e normaliza versão do MC, loader e data', async () => {
      routes({
        modrinth: () => ok({ total_hits: 30, hits: [modrinthHit('aaa', 100)] }),
        curseforge: () => ok({ data: [curseForgeMod(7, 900)], pagination: { totalCount: 12 } }),
      });

      const res = await service.search({ query: 'all the mods', sort: 'downloads' });

      expect(res.total).toBe(42);
      expect(res.results.map((r) => [r.source, r.id])).toEqual([
        ['CURSEFORGE', '7'],
        ['MODRINTH', 'aaa'],
      ]);
      expect(res.results[1]).toMatchObject({
        gameVersion: '1.20.1',
        loader: 'fabric',
        dateModified: new Date('2026-03-01T10:00:00Z'),
      });
      expect(res.results[0]).toMatchObject({ gameVersion: '1.20.1', loader: 'forge' });
    });

    it('consulta apenas modpacks (facet project_type:modpack e classId 4471) com a chave da CurseForge', async () => {
      routes({
        modrinth: () => ok({ hits: [] }),
        curseforge: () => ok({ data: [] }),
      });

      await service.search({ query: 'atm' });

      const mr = new URL(urlsCalled('modrinth')[0]);
      expect(mr.pathname).toBe('/v2/search');
      expect(mr.searchParams.get('query')).toBe('atm');
      expect(JSON.parse(mr.searchParams.get('facets')!)).toEqual([['project_type:modpack']]);

      const cfCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes('curseforge'))!;
      const cf = new URL(cfCall[0]);
      expect(cf.pathname).toBe('/v1/mods/search');
      expect(cf.searchParams.get('classId')).toBe('4471');
      expect(cf.searchParams.get('searchFilter')).toBe('atm');
      expect(cfCall[1].headers['x-api-key']).toBe('cf-key');
    });

    it('traduz sort para o critério nativo de cada fonte', async () => {
      routes({ modrinth: () => ok({ hits: [] }), curseforge: () => ok({ data: [] }) });

      for (const [sort, mrIndex, cfField] of [
        ['relevance', 'relevance', '2'],
        ['downloads', 'downloads', '6'],
        ['updated', 'updated', '3'],
      ] as const) {
        fetchMock.mockClear();
        ttl = 0;
        await service.search({ sort });
        expect(new URL(urlsCalled('modrinth')[0]).searchParams.get('index')).toBe(mrIndex);
        expect(new URL(urlsCalled('curseforge')[0]).searchParams.get('sortField')).toBe(cfField);
      }
    });

    it('em relevance intercala as fontes em vez de reordenar por downloads', async () => {
      routes({
        modrinth: () => ok({ hits: [modrinthHit('m1', 10), modrinthHit('m2', 5)] }),
        curseforge: () => ok({ data: [curseForgeMod(1, 9000), curseForgeMod(2, 8000)] }),
      });

      const res = await service.search({ limit: 4 });

      expect(res.results.map((r) => r.id)).toEqual(['m1', '1', 'm2', '2']);
    });

    it('em updated ordena as fontes pela data de modificação mais recente', async () => {
      routes({
        modrinth: () =>
          ok({ hits: [modrinthHit('old', 1, { date_modified: '2026-01-01T00:00:00Z' })] }),
        curseforge: () => ok({ data: [curseForgeMod(1, 1)] }),
      });

      const res = await service.search({ sort: 'updated' });

      expect(res.results.map((r) => r.id)).toEqual(['1', 'old']);
    });

    it('filtra por versão do MC, loader e categoria nas duas fontes', async () => {
      routes({
        modrinth: () => ok({ hits: [] }),
        curseforge: () =>
          fetchMock.mock.calls.at(-1)![0].includes('/categories')
            ? ok({
                data: [
                  { id: 410, slug: 'adventure' },
                  { id: 411, slug: 'tech' },
                ],
              })
            : ok({ data: [] }),
      });

      await service.search({ gameVersion: '1.20.1', loader: 'fabric', category: 'adventure' });

      const mr = new URL(urlsCalled('modrinth')[0]);
      expect(JSON.parse(mr.searchParams.get('facets')!)).toEqual([
        ['project_type:modpack'],
        ['versions:1.20.1'],
        ['categories:fabric'],
        ['categories:adventure'],
      ]);

      const cf = new URL(urlsCalled('mods/search')[0]);
      expect(cf.searchParams.get('gameVersion')).toBe('1.20.1');
      expect(cf.searchParams.get('modLoaderType')).toBe('4');
      expect(cf.searchParams.get('categoryId')).toBe('410');
    });

    it('categoria inexistente na CurseForge não traz resultados dela, mas mantém os do Modrinth', async () => {
      routes({
        modrinth: () => ok({ total_hits: 1, hits: [modrinthHit('aaa', 5)] }),
        curseforge: () => ok({ data: [{ id: 411, slug: 'tech' }] }),
      });

      const res = await service.search({ category: 'adventure' });

      expect(res.results.map((r) => r.id)).toEqual(['aaa']);
      expect(urlsCalled('mods/search')).toHaveLength(0);
    });

    it('sem chave da CurseForge busca só no Modrinth, sem falhar nem chamar a CurseForge', async () => {
      apiKey = '';
      routes({ modrinth: () => ok({ total_hits: 1, hits: [modrinthHit('aaa', 5)] }) });

      const res = await service.search({ query: 'x' });

      expect(res.results.map((r) => r.source)).toEqual(['MODRINTH']);
      expect(urlsCalled('curseforge')).toHaveLength(0);
    });

    it('pedir explicitamente CurseForge sem chave é 503, não lista vazia', async () => {
      apiKey = '';

      await expect(service.search({ source: 'curseforge' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falha de uma fonte não derruba a outra', async () => {
      routes({
        modrinth: () => fail(500),
        curseforge: () => ok({ data: [curseForgeMod(7, 900)], pagination: { totalCount: 1 } }),
      });

      const res = await service.search({ query: 'x' });

      expect(res.results.map((r) => r.source)).toEqual(['CURSEFORGE']);
      expect(res.total).toBe(1);
    });

    it('responde 502 quando todas as fontes consultadas falham', async () => {
      routes({ modrinth: () => fail(500), curseforge: () => fail(403) });

      await expect(service.search({ query: 'x' })).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('divide a página entre as fontes e repassa offset por fonte', async () => {
      routes({
        modrinth: () => ok({ hits: [] }),
        curseforge: () => ok({ data: [] }),
      });

      await service.search({ limit: 20, offset: 40 });

      const mr = new URL(urlsCalled('modrinth')[0]).searchParams;
      const cf = new URL(urlsCalled('curseforge')[0]).searchParams;
      expect([mr.get('limit'), mr.get('offset')]).toEqual(['10', '20']);
      expect([cf.get('pageSize'), cf.get('index')]).toEqual(['10', '20']);
    });

    it('com uma única fonte usa a página inteira e nunca devolve mais que o limite', async () => {
      routes({
        modrinth: () =>
          ok({ hits: [modrinthHit('a', 3), modrinthHit('b', 2), modrinthHit('c', 1)] }),
      });

      const res = await service.search({ source: 'modrinth', limit: 2, offset: 4 });

      const mr = new URL(urlsCalled('modrinth')[0]).searchParams;
      expect([mr.get('limit'), mr.get('offset')]).toEqual(['2', '4']);
      expect(res.results).toHaveLength(2);
      expect(res).toMatchObject({ limit: 2, offset: 4 });
    });

    it('limita o page size a 50 e ignora valores inválidos', async () => {
      routes({ modrinth: () => ok({ hits: [] }) });

      await service.search({ source: 'modrinth', limit: 9999, offset: -3 });
      await service.search({ source: 'modrinth', limit: 'abc' as any, query: 'y' });

      const [first, second] = urlsCalled('modrinth').map((u) => new URL(u).searchParams);
      expect([first.get('limit'), first.get('offset')]).toEqual(['50', '0']);
      expect(second.get('limit')).toBe('20');
    });

    it('não pede à CurseForge além da janela máxima de 10000 itens', async () => {
      routes({ curseforge: () => ok({ data: [] }) });

      const res = await service.search({ source: 'curseforge', offset: 10000 });

      expect(urlsCalled('curseforge')).toHaveLength(0);
      expect(res.results).toEqual([]);
    });

    it('reaproveita a resposta dentro do TTL e consulta de novo depois dele', async () => {
      routes({ modrinth: () => ok({ hits: [] }) });
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      await service.search({ source: 'modrinth', query: 'a' });
      await service.search({ source: 'modrinth', query: 'a' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await service.search({ source: 'modrinth', query: 'b' });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      now.mockReturnValue(1_000_000 + ttl + 1);
      await service.search({ source: 'modrinth', query: 'a' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('TTL zero desliga o cache', async () => {
      ttl = 0;
      routes({ modrinth: () => ok({ hits: [] }) });

      await service.search({ source: 'modrinth', query: 'a' });
      await service.search({ source: 'modrinth', query: 'a' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('não cacheia respostas com erro', async () => {
      routes({ modrinth: () => fail(500) });
      await expect(service.search({ source: 'modrinth' })).rejects.toBeInstanceOf(
        BadGatewayException,
      );

      routes({ modrinth: () => ok({ hits: [modrinthHit('a', 1)] }) });
      const res = await service.search({ source: 'modrinth' });

      expect(res.results).toHaveLength(1);
    });
  });

  describe('getVersions', () => {
    it('lista versões do Modrinth com MC, loader, tipo, data e URL do arquivo primário', async () => {
      routes({
        modrinth: () =>
          ok([
            {
              id: 'v1',
              name: 'Pack 2.0',
              version_number: '2.0',
              game_versions: ['1.20.1', '1.20.4'],
              loaders: ['fabric'],
              version_type: 'beta',
              date_published: '2026-02-01T00:00:00Z',
              files: [
                { url: 'https://cdn.modrinth.com/extra.zip', primary: false },
                { url: 'https://cdn.modrinth.com/pack.mrpack', primary: true },
              ],
            },
          ]),
      });

      const versions = await service.getVersions('aaa', 'modrinth');

      expect(new URL(urlsCalled('modrinth')[0]).pathname).toBe('/v2/project/aaa/version');
      expect(versions).toEqual([
        {
          id: 'v1',
          name: 'Pack 2.0',
          gameVersion: '1.20.4',
          loader: 'fabric',
          releaseType: 'beta',
          datePublished: new Date('2026-02-01T00:00:00Z'),
          downloadUrl: 'https://cdn.modrinth.com/pack.mrpack',
        },
      ]);
    });

    it('lista arquivos da CurseForge e deixa downloadUrl vazio quando a API devolve null', async () => {
      routes({
        curseforge: () =>
          ok({
            data: [
              {
                id: 55,
                displayName: 'ATM9 0.3',
                fileName: 'atm9.zip',
                releaseType: 2,
                fileDate: '2026-05-01T00:00:00Z',
                downloadUrl: null,
                gameVersions: ['Forge', '1.20.1', 'Java 17'],
              },
            ],
          }),
      });

      const [version] = await service.getVersions('123', 'curseforge');

      expect(version).toMatchObject({
        id: '55',
        name: 'ATM9 0.3',
        gameVersion: '1.20.1',
        loader: 'forge',
        releaseType: 'beta',
        downloadUrl: undefined,
      });
    });

    it('infere a fonte pelo formato do id quando source não é informado', async () => {
      routes({ modrinth: () => ok([]), curseforge: () => ok({ data: [] }) });

      await service.getVersions('123');
      await service.getVersions('AANobbMI');

      expect(urlsCalled('curseforge')).toHaveLength(1);
      expect(urlsCalled('modrinth')).toHaveLength(1);
    });

    it('CurseForge sem chave é 503 e erro upstream vira 502', async () => {
      apiKey = '';
      await expect(service.getVersions('123', 'curseforge')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      routes({ modrinth: () => fail(404) });
      await expect(service.getVersions('nope', 'modrinth')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });
});
