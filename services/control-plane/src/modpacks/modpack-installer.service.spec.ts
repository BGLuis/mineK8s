import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ModpackInstallerService } from './modpack-installer.service';
import { Server } from '@database/entities/server.entity';
import { ModpackTaskEntity, ModpackTaskStatus } from '@database/entities/modpack-task.entity';
import { ModrinthResolverService } from './resolvers/modrinth-resolver.service';

function createZipBuffer(
  files: Array<{ name: string; content?: string | Buffer; isSymlink?: boolean }>,
): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf-8');
    const contentBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content || '', 'utf-8');
    const crc = (zlib as any).crc32(contentBuf);

    // Local file header
    const local = Buffer.alloc(30 + filenameBuf.length + contentBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // general purpose bit flag
    local.writeUInt16LE(0, 8); // compression method (STORE)
    local.writeUInt16LE(0, 10); // file time
    local.writeUInt16LE(0, 12); // file date
    local.writeUInt32LE(crc, 14); // crc32
    local.writeUInt32LE(contentBuf.length, 18); // compressed size
    local.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    local.writeUInt16LE(filenameBuf.length, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length
    filenameBuf.copy(local, 30);
    contentBuf.copy(local, 30 + filenameBuf.length);

    localHeaders.push(local);

    // Central directory file header
    const externalAttr = file.isSymlink ? (0o120777 << 16) >>> 0 : (0o100644 << 16) >>> 0;
    const central = Buffer.alloc(46 + filenameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // general purpose bit flag
    central.writeUInt16LE(0, 10); // compression method (STORE)
    central.writeUInt16LE(0, 12); // file time
    central.writeUInt16LE(0, 14); // file date
    central.writeUInt32LE(crc, 16); // crc32
    central.writeUInt32LE(contentBuf.length, 20); // compressed size
    central.writeUInt32LE(contentBuf.length, 24); // uncompressed size
    central.writeUInt16LE(filenameBuf.length, 28); // file name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(externalAttr, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    filenameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length;
  }

  const centralSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  endRecord.writeUInt16LE(0, 4); // disk number
  endRecord.writeUInt16LE(0, 6); // disk with central directory
  endRecord.writeUInt16LE(files.length, 8); // entries on disk
  endRecord.writeUInt16LE(files.length, 10); // total entries
  endRecord.writeUInt32LE(centralSize, 12); // size of central dir
  endRecord.writeUInt32LE(offset, 16); // offset of central dir
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord]);
}

describe('ModpackInstallerService (RF-STO-11, RF-STO-12, RF-STO-18)', () => {
  let service: ModpackInstallerService;
  let tempStorageRoot: string;
  let tempCacheRoot: string;
  let sampleServer: Server;
  let mockCasStorage: any;
  let mockModrinthResolver: any;
  let mockCurseforgeResolver: any;
  let mockConfigInjector: any;
  let mockTasksGateway: any;
  let mockTaskRepo: any;
  let mockServerRepo: any;
  let inMemoryTasks: ModpackTaskEntity[];

  beforeEach(async () => {
    tempStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'installer-data-'));
    tempCacheRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'installer-cache-'));
    inMemoryTasks = [];

    sampleServer = {
      id: 'srv-modpack-1',
      name: 'Modpack Server',
      subdomain: 'endereco-novo',
      resource_name: 'modpack-smp',
      state: 'STOPPED',
      server_type: 'FABRIC',
      game_version: '1.20.1',
    } as Server;

    const mockConfigService = {
      storage: {
        serversDataRoot: tempStorageRoot,
        sharedCachePath: tempCacheRoot,
      },
    };

    const casFiles = new Map<string, Buffer>();
    mockCasStorage = {
      computeSha1: jest
        .fn()
        .mockImplementation((buf: Buffer | string) =>
          crypto.createHash('sha1').update(buf).digest('hex'),
        ),
      has: jest.fn().mockImplementation(async (hash) => casFiles.has(hash)),
      store: jest.fn().mockImplementation(async (buf, name, opts) => {
        const sha256 = opts?.sha256 || crypto.createHash('sha256').update(buf).digest('hex');
        casFiles.set(sha256, buf);
        if (opts?.sha1) casFiles.set(opts.sha1, buf);
        return {
          sha256,
          fileName: name,
          storagePath: path.join(tempCacheRoot, name),
        };
      }),
      copyOrLinkTo: jest.fn().mockImplementation(async (hash, dest) => {
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        const buf = casFiles.get(hash) || Buffer.from('dummy-jar-content');
        await fs.promises.writeFile(dest, buf);
        return 'copied';
      }),
    };

    const realModrinthResolver = new ModrinthResolverService();
    mockModrinthResolver = {
      parseIndex: (json: any) => realModrinthResolver.parseIndex(json),
      resolveServerFiles: jest
        .fn()
        .mockImplementation((idx) => realModrinthResolver.resolveServerFiles(idx)),
      extractIndexFromMrpack: jest
        .fn()
        .mockImplementation((buf) => realModrinthResolver.extractIndexFromMrpack(buf)),
      extractOverrides: jest
        .fn()
        .mockImplementation((buf, dir) => realModrinthResolver.extractOverrides(buf, dir)),
    };

    mockCurseforgeResolver = {
      filterClientOnlyFiles: jest.fn().mockReturnValue({
        accepted: [{ projectID: 1, fileID: 10, required: true }],
        discarded: [],
      }),
    };

    mockConfigInjector = {
      injectConfigurationMatrix: jest.fn().mockResolvedValue(undefined),
    };

    mockTasksGateway = {
      emitTaskProgress: jest.fn(),
    };

    mockTaskRepo = {
      save: jest.fn().mockImplementation(async (entity) => {
        if (!entity.id) {
          entity.id = `task-${inMemoryTasks.length + 1}`;
        }
        const idx = inMemoryTasks.findIndex((t) => t.id === entity.id);
        if (idx >= 0) {
          inMemoryTasks[idx] = entity;
        } else {
          inMemoryTasks.push(entity);
        }
        return entity;
      }),
    };

    mockServerRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }) => {
        if (where?.id === sampleServer.id) return sampleServer;
        return null;
      }),
      save: jest.fn().mockImplementation(async (s) => s),
    };

    service = new ModpackInstallerService(
      mockConfigService as any,
      mockCasStorage,
      mockModrinthResolver,
      mockCurseforgeResolver,
      mockConfigInjector,
      mockTasksGateway,
      mockTaskRepo,
      mockServerRepo,
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempStorageRoot, { recursive: true, force: true });
    await fs.promises.rm(tempCacheRoot, { recursive: true, force: true });
  });

  it('deve rejeitar instalação com ConflictException se servidor estiver READY', async () => {
    sampleServer.state = 'READY';

    await expect(
      service.installModpack(sampleServer.id, {
        source: 'MODRINTH',
        projectId: 'precision-pack',
        versionId: '1.0.0',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('deve rejeitar instalação com NotFoundException se servidor não for encontrado', async () => {
    await expect(
      service.installModpack('nonexistent-id', {
        source: 'MODRINTH',
        projectId: 'precision-pack',
        versionId: '1.0.0',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve criar tarefa QUEUED, emitir evento no WebSocket e iniciar pipeline', async () => {
    sampleServer.state = 'STOPPED';
    // O pipeline tem teste próprio; rodá-lo solto escreve no diretório temporário enquanto o afterEach o apaga.
    const runPipeline = jest.spyOn(service, 'runPipeline').mockResolvedValue(undefined);

    const res = await service.installModpack(sampleServer.id, {
      source: 'MODRINTH',
      projectId: 'precision-pack',
      versionId: '1.0.0',
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(res.taskId).toBeDefined();
    expect(res.status).toBe(ModpackTaskStatus.QUEUED);
    expect(mockTasksGateway.emitTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ModpackTaskStatus.QUEUED,
        progressPercent: 0,
      }),
    );
  });

  it('runPipeline deve executar resolução, download via CAS, injeção de configuração e concluir COMPLETED', async () => {
    const task: ModpackTaskEntity = {
      id: 'task-test-pipeline',
      serverId: sampleServer.id,
      source: 'MODRINTH',
      projectId: 'precision-pack',
      versionId: '1.0.0',
      status: ModpackTaskStatus.QUEUED,
      progressPercent: 0,
      currentStep: 'Iniciando',
      downloadedFiles: 0,
      totalFiles: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    const mockFiles = [
      { name: 'lithium.jar', hashes: { sha1: '1111' }, buffer: Buffer.from('lithium-data') },
      { name: 'ferritecore.jar', hashes: { sha1: '2222' }, buffer: Buffer.from('ferrite-data') },
    ];

    await service.runPipeline(
      sampleServer,
      task,
      {
        source: 'MODRINTH',
        projectId: 'precision-pack',
        versionId: '1.0.0',
      },
      mockFiles,
    );

    // Deve ter consultado e armazenado no CAS
    expect(mockCasStorage.store).toHaveBeenCalledTimes(2);
    expect(mockCasStorage.copyOrLinkTo).toHaveBeenCalledTimes(2);

    // Deve ter chamado o injetor de configuração
    expect(mockConfigInjector.injectConfigurationMatrix).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ isModpack: true }),
    );

    // Deve ter atualizado o status da task para COMPLETED com 100%
    expect(task.status).toBe(ModpackTaskStatus.COMPLETED);
    expect(task.progressPercent).toBe(100);

    // WebSocket deve ter recebido as emissões de progresso
    expect(mockTasksGateway.emitTaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ModpackTaskStatus.COMPLETED,
        progressPercent: 100,
      }),
    );
  });

  it('instala no diretório de dados do resource_name, que é o do PVC, e não no do subdomínio', async () => {
    const serverDir = service.getServerDataDir(sampleServer);

    expect(serverDir).toBe(path.join(tempStorageRoot, 'data-modpack-smp', 'volume'));
    expect(fs.existsSync(path.join(tempStorageRoot, 'data-endereco-novo'))).toBe(false);
  });

  it('CRITÉRIO DE ACEITE: com uma fixture .mrpack, o runPipeline grava em mods/ exatamente os arquivos com env.server != unsupported, cada um com o SHA-1 do índice', async () => {
    const lithiumContent = Buffer.from('lithium-mod-binary-data');
    const lithiumSha1 = crypto.createHash('sha1').update(lithiumContent).digest('hex');

    const ferriteContent = Buffer.from('ferrite-mod-binary-data');
    const ferriteSha1 = crypto.createHash('sha1').update(ferriteContent).digest('hex');

    const sodiumSha1 = '0123456789abcdef0123456789abcdef01234567';

    const indexJson = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1.0.0',
      name: 'Test Modpack',
      dependencies: {
        minecraft: '1.20.1',
        'fabric-loader': '0.15.11',
      },
      files: [
        {
          path: 'mods/sodium-fabric.jar',
          hashes: { sha1: sodiumSha1 },
          env: { client: 'required', server: 'unsupported' },
          downloads: ['https://downloads.test/sodium.jar'],
        },
        {
          path: 'mods/lithium-fabric.jar',
          hashes: { sha1: lithiumSha1 },
          env: { client: 'optional', server: 'required' },
          downloads: ['https://downloads.test/lithium.jar'],
        },
        {
          path: 'mods/ferritecore.jar',
          hashes: { sha1: ferriteSha1 },
          env: { client: 'optional', server: 'optional' },
          downloads: ['https://downloads.test/ferritecore.jar'],
        },
      ],
    };

    const mrpackBuffer = createZipBuffer([
      { name: 'modrinth.index.json', content: JSON.stringify(indexJson) },
    ]);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string) => {
      if (url === 'https://downloads.test/lithium.jar') {
        return new Response(lithiumContent, { status: 200 });
      }
      if (url === 'https://downloads.test/ferritecore.jar') {
        return new Response(ferriteContent, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const task: ModpackTaskEntity = {
        id: 'task-test-mrpack',
        serverId: sampleServer.id,
        source: 'MODRINTH',
        projectId: 'test-pack',
        versionId: '1.0.0',
        status: ModpackTaskStatus.QUEUED,
        progressPercent: 0,
        currentStep: 'Iniciando',
        downloadedFiles: 0,
        totalFiles: 0,
        startedAt: new Date(),
        updatedAt: new Date(),
      };

      await service.runPipeline(
        sampleServer,
        task,
        {
          source: 'MODRINTH',
          projectId: 'test-pack',
          versionId: '1.0.0',
        },
        mrpackBuffer,
      );

      expect(task.status).toBe(ModpackTaskStatus.COMPLETED);

      const serverDir = service.getServerDataDir(sampleServer);
      const modsDir = path.join(serverDir, 'mods');

      // Sodium (env.server = unsupported) NÃO deve existir
      expect(fs.existsSync(path.join(modsDir, 'sodium-fabric.jar'))).toBe(false);

      // Lithium e FerriteCore devem existir
      expect(fs.existsSync(path.join(modsDir, 'lithium-fabric.jar'))).toBe(true);
      expect(fs.existsSync(path.join(modsDir, 'ferritecore.jar'))).toBe(true);

      // Hash SHA-1 de cada arquivo gravado em mods/ deve bater exatamente com o do índice
      const recordedLithium = await fs.promises.readFile(path.join(modsDir, 'lithium-fabric.jar'));
      const recordedFerrite = await fs.promises.readFile(path.join(modsDir, 'ferritecore.jar'));

      expect(crypto.createHash('sha1').update(recordedLithium).digest('hex')).toBe(lithiumSha1);
      expect(crypto.createHash('sha1').update(recordedFerrite).digest('hex')).toBe(ferriteSha1);

      // Loader registrado no servidor
      expect(sampleServer.server_type).toBe('FABRIC');
      expect(sampleServer.game_version).toBe('1.20.1');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('CRITÉRIO DE ACEITE: um arquivo cujo hash não confere faz a task terminar em FAILED, sem deixar o arquivo em mods/', async () => {
    const wrongSha1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const indexJson = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1.0.0',
      name: 'Corrupt Pack',
      dependencies: { minecraft: '1.20.1' },
      files: [
        {
          path: 'mods/corrupted-mod.jar',
          hashes: { sha1: wrongSha1 },
          env: { server: 'required' },
          downloads: ['https://downloads.test/corrupted.jar'],
        },
      ],
    };

    const mrpackBuffer = createZipBuffer([
      { name: 'modrinth.index.json', content: JSON.stringify(indexJson) },
    ]);

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: string) => {
      if (url === 'https://downloads.test/corrupted.jar') {
        return new Response(Buffer.from('actual-data-with-different-hash'), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const task: ModpackTaskEntity = {
        id: 'task-test-corrupt',
        serverId: sampleServer.id,
        source: 'MODRINTH',
        projectId: 'corrupt-pack',
        versionId: '1.0.0',
        status: ModpackTaskStatus.QUEUED,
        progressPercent: 0,
        currentStep: 'Iniciando',
        downloadedFiles: 0,
        totalFiles: 0,
        startedAt: new Date(),
        updatedAt: new Date(),
      };

      await service.runPipeline(
        sampleServer,
        task,
        {
          source: 'MODRINTH',
          projectId: 'corrupt-pack',
          versionId: '1.0.0',
        },
        mrpackBuffer,
      );

      // Task deve terminar em FAILED
      expect(task.status).toBe(ModpackTaskStatus.FAILED);
      expect(task.errorMessage).toContain('Hash mismatch');

      // O arquivo NÃO deve ficar em mods/
      const serverDir = service.getServerDataDir(sampleServer);
      const corruptFile = path.join(serverDir, 'mods', 'corrupted-mod.jar');
      expect(fs.existsSync(corruptFile)).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
