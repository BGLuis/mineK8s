import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ModpackInstallerService } from './modpack-installer.service';
import { Server } from '@database/entities/server.entity';
import { ModpackTaskEntity, ModpackTaskStatus } from '@database/entities/modpack-task.entity';

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
      subdomain: 'modpack-smp',
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

    mockCasStorage = {
      computeSha1: jest.fn().mockReturnValue('dummy-sha1'),
      has: jest.fn().mockResolvedValue(false),
      store: jest.fn().mockImplementation(async (buf, name) => ({
        sha256: 'dummy-sha256',
        fileName: name,
        storagePath: path.join(tempCacheRoot, name),
      })),
      copyOrLinkTo: jest.fn().mockImplementation(async (hash, dest) => {
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, 'dummy-jar-content');
        return 'copied';
      }),
    };

    mockModrinthResolver = {
      resolveServerFiles: jest.fn().mockReturnValue({
        acceptedFiles: [{ path: 'mods/fabric-api.jar', hashes: { sha1: '1111' } }],
        discardedFiles: [],
      }),
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

    const res = await service.installModpack(sampleServer.id, {
      source: 'MODRINTH',
      projectId: 'precision-pack',
      versionId: '1.0.0',
    });

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
});
