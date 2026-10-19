import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from '@database/entities/server.entity';
import { ServerContent } from '@database/entities/server-content.entity';
import { ServersContentService } from './servers-content.service';

describe('ServersContentService (#207)', () => {
  let service: ServersContentService;
  let tempDir: string;
  let serverDataDir: string;
  let contentDb: Map<string, ServerContent>;
  let serversDb: Map<string, Server>;
  let mockContentRepo: any;
  let mockServerRepo: any;
  let testServer: Server;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minek8s-content-test-'));
    serverDataDir = path.join(tempDir, 'data-survival');
    fs.mkdirSync(serverDataDir, { recursive: true });

    contentDb = new Map();
    serversDb = new Map();

    testServer = {
      id: 'srv-content-1',
      name: 'Survival',
      subdomain: 'survival',
      resource_name: 'survival',
      game_type: 'minecraft',
      server_type: 'FABRIC',
      game_version: '1.20.1',
      state: 'READY',
    } as unknown as Server;
    serversDb.set(testServer.id, testServer);

    mockContentRepo = {
      create: jest.fn((dto) => ({ id: `sc-${Date.now()}-${Math.random()}`, ...dto })),
      save: jest.fn(async (entity) => {
        const id = entity.id || `sc-${Date.now()}-${Math.random()}`;
        entity.id = id;
        contentDb.set(id, { ...entity });
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        for (const item of contentDb.values()) {
          if (where.serverId && item.serverId !== where.serverId) continue;
          if (where.path && item.path !== where.path) continue;
          if (where.id && item.id !== where.id) continue;
          return { ...item };
        }
        return null;
      }),
      find: jest.fn(async ({ where }: any = {}) => {
        const results: ServerContent[] = [];
        for (const item of contentDb.values()) {
          if (where?.serverId && item.serverId !== where.serverId) continue;
          results.push({ ...item });
        }
        return results;
      }),
      delete: jest.fn(async (criteria: any) => {
        if (typeof criteria === 'string') {
          contentDb.delete(criteria);
          return;
        }
        for (const [id, item] of Array.from(contentDb.entries())) {
          if (criteria.serverId && item.serverId !== criteria.serverId) continue;
          if (criteria.path && item.path !== criteria.path) continue;
          if (criteria.id && item.id !== criteria.id) continue;
          contentDb.delete(id);
        }
      }),
    };

    mockServerRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        return serversDb.get(where.id) || null;
      }),
    };

    const mockConfigService: any = {
      storage: {
        serversDataRoot: tempDir,
      },
    };

    service = new ServersContentService(mockConfigService, mockContentRepo, mockServerRepo);

    serverDataDir = service.getServerDataDir(testServer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Critério 1: Modrinth fixture - item com update aparece como "atualiza para X"; sem update como "sem versão compatível"', () => {
    it('deve categorizar mods entre UPDATE_AVAILABLE, INCOMPATIBLE e UNIDENTIFIED', async () => {
      // 1. Mod com atualização disponível
      const hashWithUpdate = 'aaaa111122223333444455556666777788889999';
      // 2. Mod conhecido sem versão compatível
      const hashWithoutUpdate = 'bbbb111122223333444455556666777788889999';
      // 3. Mod manual desconhecido (não identificado)
      const hashUnknown = 'cccc111122223333444455556666777788889999';

      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/fabric-api-0.90.jar',
        sha1: hashWithUpdate,
        origin: 'MANUAL',
        projectId: 'fabric-api',
        versionId: 'ver-old-1',
      });

      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/incompatible-mod-1.0.jar',
        sha1: hashWithoutUpdate,
        origin: 'MANUAL',
        projectId: 'incompatible-mod',
        versionId: 'ver-incompat-1',
      });

      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/custom-unknown.jar',
        sha1: hashUnknown,
        origin: 'MANUAL',
        projectId: null,
      });

      // Mock da API Modrinth: POST /v2/version_files/update
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/version_files/update')) {
          const body = JSON.parse(init.body);
          expect(body.game_versions).toEqual(['1.21.1']);
          expect(body.loaders).toContain('fabric');

          // Retorna apenas o item atualizável
          return {
            ok: true,
            status: 200,
            json: async () => ({
              [hashWithUpdate]: {
                id: 'ver-new-fabric-api',
                version_number: '0.100.0',
                name: 'Fabric API 0.100.0 (1.21.1)',
                files: [
                  {
                    primary: true,
                    filename: 'fabric-api-0.100.0.jar',
                    url: 'https://cdn.modrinth.com/data/fabric-api/fabric-api-0.100.0.jar',
                    hashes: { sha1: '1111111111111111111111111111111111111111' },
                  },
                ],
              },
            }),
          } as any;
        }
        if (urlStr.includes('/version_files')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const preview = await service.previewCompatibility(testServer, {
        game_version: '1.21.1',
        server_type: 'FABRIC',
      });

      expect(preview.canUpdate).toBe(true);
      expect(preview.targetGameVersion).toBe('1.21.1');
      expect(preview.items).toHaveLength(3);

      const itemWithUpdate = preview.items.find((i) => i.path === 'mods/fabric-api-0.90.jar');
      expect(itemWithUpdate).toBeDefined();
      expect(itemWithUpdate?.status).toBe('UPDATE_AVAILABLE');
      expect(itemWithUpdate?.statusMessage).toBe('Atualiza para 0.100.0');
      expect(itemWithUpdate?.targetVersionId).toBe('ver-new-fabric-api');
      expect(itemWithUpdate?.targetDownloadUrl).toBe(
        'https://cdn.modrinth.com/data/fabric-api/fabric-api-0.100.0.jar',
      );

      const itemIncompat = preview.items.find((i) => i.path === 'mods/incompatible-mod-1.0.jar');
      expect(itemIncompat).toBeDefined();
      expect(itemIncompat?.status).toBe('INCOMPATIBLE');
      expect(itemIncompat?.statusMessage).toBe('Sem versão compatível');

      const itemUnknown = preview.items.find((i) => i.path === 'mods/custom-unknown.jar');
      expect(itemUnknown).toBeDefined();
      expect(itemUnknown?.status).toBe('UNIDENTIFIED');
      expect(itemUnknown?.statusMessage).toBe('Não identificado');
    });
  });

  describe('Critério 2: Manual jar com SHA-1 conhecido é identificado e ganha project_id / version_id', () => {
    it('deve identificar jar manual via POST /v2/version_files da Modrinth', async () => {
      const knownJarContent = Buffer.from('dummy-jar-content-for-sodium');
      const knownSha1 = crypto.createHash('sha1').update(knownJarContent).digest('hex');

      // Cria o arquivo físico em mods/
      const modsDir = path.join(serverDataDir, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });
      fs.writeFileSync(path.join(modsDir, 'sodium-fabric-0.5.8.jar'), knownJarContent);

      // Mock da API Modrinth: POST /v2/version_files
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          const urlStr = url.toString();
          if (urlStr.includes('/version_files')) {
            const body = JSON.parse(init.body);
            expect(body.hashes).toContain(knownSha1);
            return {
              ok: true,
              status: 200,
              json: async () => ({
                [knownSha1]: {
                  id: 'version-sodium-58',
                  project_id: 'sodium',
                  loaders: ['fabric', 'quilt'],
                },
              }),
            } as any;
          }
          return { ok: false, status: 404 } as any;
        });

      const identifiedList = await service.identifyContents(testServer.id);
      expect(identifiedList.length).toBeGreaterThanOrEqual(1);

      const sodiumEntry = identifiedList.find((c) => c.path === 'mods/sodium-fabric-0.5.8.jar');
      expect(sodiumEntry).toBeDefined();
      expect(sodiumEntry?.projectId).toBe('sodium');
      expect(sodiumEntry?.versionId).toBe('version-sodium-58');
      expect(sodiumEntry?.source).toBe('MODRINTH');
      expect(sodiumEntry?.origin).toBe('MANUAL');
      expect(sodiumEntry?.loaders).toEqual(['fabric', 'quilt']);
    });
  });

  describe('Critério 3: Update com item "remover" remove o arquivo; item "atualizar" instala nova versão verificada', () => {
    it('deve remover o arquivo quando ação for REMOVE e baixar nova versão verificada quando ação for UPDATE', async () => {
      const modsDir = path.join(serverDataDir, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });

      // Arquivo a ser removido
      const removeFileRel = 'mods/old-deprecated-mod.jar';
      const removeFileAbs = path.join(serverDataDir, removeFileRel);
      fs.writeFileSync(removeFileAbs, 'old-mod-content');
      await service.recordContent({
        serverId: testServer.id,
        path: removeFileRel,
        origin: 'MANUAL',
      });

      // Arquivo a ser atualizado
      const updateFileRel = 'mods/mod-v1.jar';
      const updateFileAbs = path.join(serverDataDir, updateFileRel);
      fs.writeFileSync(updateFileAbs, 'mod-v1-content');
      await service.recordContent({
        serverId: testServer.id,
        path: updateFileRel,
        origin: 'MANUAL',
      });

      // Novo buffer para update
      const newJarBuffer = Buffer.from('verified-mod-v2-binary');
      const newSha1 = crypto.createHash('sha1').update(newJarBuffer).digest('hex');
      const newSha512 = crypto.createHash('sha512').update(newJarBuffer).digest('hex');

      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (url.toString() === 'https://cdn.modrinth.com/data/mod-v2.jar') {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () =>
              newJarBuffer.buffer.slice(
                newJarBuffer.byteOffset,
                newJarBuffer.byteOffset + newJarBuffer.byteLength,
              ),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      await service.applyContentActions(testServer, serverDataDir, [
        {
          path: removeFileRel,
          action: 'REMOVE',
        },
        {
          path: updateFileRel,
          action: 'UPDATE',
          targetDownloadUrl: 'https://cdn.modrinth.com/data/mod-v2.jar',
          targetFileName: 'mod-v2.jar',
          targetVersionId: 'ver-v2-id',
          targetHashes: {
            sha1: newSha1,
            sha512: newSha512,
          },
        },
      ]);

      // 1. Verifica remoção
      expect(fs.existsSync(removeFileAbs)).toBe(false);
      const removedDbItem = await mockContentRepo.findOne({
        where: { serverId: testServer.id, path: removeFileRel },
      });
      expect(removedDbItem).toBeNull();

      // 2. Verifica update e integridade
      expect(fs.existsSync(updateFileAbs)).toBe(false); // arquivo antigo removido
      const newFileAbs = path.join(serverDataDir, 'mods/mod-v2.jar');
      expect(fs.existsSync(newFileAbs)).toBe(true);
      expect(fs.readFileSync(newFileAbs)).toEqual(newJarBuffer);

      const updatedDbItem = await mockContentRepo.findOne({
        where: { serverId: testServer.id, path: 'mods/mod-v2.jar' },
      });
      expect(updatedDbItem).toBeDefined();
      expect(updatedDbItem?.sha1).toBe(newSha1);
      expect(updatedDbItem?.sha512).toBe(newSha512);
      expect(updatedDbItem?.versionId).toBe('ver-v2-id');
    });

    it('deve rejeitar e falhar update caso haja hash mismatch', async () => {
      const modsDir = path.join(serverDataDir, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });
      const updateFileRel = 'mods/bad-mod.jar';
      const updateFileAbs = path.join(serverDataDir, updateFileRel);
      fs.writeFileSync(updateFileAbs, 'initial-content');

      const tamperedBuffer = Buffer.from('tampered-binary-data');

      jest.spyOn(global, 'fetch').mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            tamperedBuffer.buffer.slice(
              tamperedBuffer.byteOffset,
              tamperedBuffer.byteOffset + tamperedBuffer.byteLength,
            ),
        } as any;
      });

      await expect(
        service.applyContentActions(testServer, serverDataDir, [
          {
            path: updateFileRel,
            action: 'UPDATE',
            targetDownloadUrl: 'https://cdn.modrinth.com/data/tampered.jar',
            targetHashes: {
              sha1: 'expected-sha1-that-will-not-match',
            },
          },
        ]),
      ).rejects.toThrow(/Hash mismatch/);
    });
  });

  describe('Critério 4: Troca de versão de modpack preserva arquivo MANUAL e remove arquivos do pack anterior', () => {
    it('deve remover apenas mods pertencentes ao pack antigo e manter intactos mods manuais', async () => {
      const modsDir = path.join(serverDataDir, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });

      // Modpack v1 instala pack-mod-a.jar e pack-mod-b.jar
      const packA = path.join(modsDir, 'pack-mod-a.jar');
      const packB = path.join(modsDir, 'pack-mod-b.jar');
      fs.writeFileSync(packA, 'pack-a');
      fs.writeFileSync(packB, 'pack-b');

      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/pack-mod-a.jar',
        origin: 'MODPACK',
        projectId: 'pack-mod-a',
      });
      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/pack-mod-b.jar',
        origin: 'MODPACK',
        projectId: 'pack-mod-b',
      });

      // Usuário instalou manualmente voicechat.jar
      const manualVoicechat = path.join(modsDir, 'simple-voice-chat.jar');
      fs.writeFileSync(manualVoicechat, 'user-manual-mod');
      await service.recordContent({
        serverId: testServer.id,
        path: 'mods/simple-voice-chat.jar',
        origin: 'MANUAL',
        projectId: 'simple-voice-chat',
      });

      // Nova versão do modpack (v2) traz pack-mod-a.jar e pack-mod-c.jar (pack-mod-b foi removido do pack)
      const newPackFiles = [{ path: 'mods/pack-mod-a.jar' }, { path: 'mods/pack-mod-c.jar' }];

      await service.syncModpackFiles(testServer, serverDataDir, newPackFiles);

      // pack-mod-b.jar não está na nova versão -> DEVE ser removido
      expect(fs.existsSync(packB)).toBe(false);
      const dbPackB = await mockContentRepo.findOne({
        where: { serverId: testServer.id, path: 'mods/pack-mod-b.jar' },
      });
      expect(dbPackB).toBeNull();

      // pack-mod-a.jar continua no novo pack -> permanece
      expect(fs.existsSync(packA)).toBe(true);

      // simple-voice-chat.jar (MANUAL) -> DEVE SOBREVIVER INTACTO
      expect(fs.existsSync(manualVoicechat)).toBe(true);
      expect(fs.readFileSync(manualVoicechat, 'utf-8')).toBe('user-manual-mod');
      const dbManual = await mockContentRepo.findOne({
        where: { serverId: testServer.id, path: 'mods/simple-voice-chat.jar' },
      });
      expect(dbManual).toBeDefined();
      expect(dbManual?.origin).toBe('MANUAL');
    });
  });
});
