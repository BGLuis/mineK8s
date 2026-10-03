import { ModpacksController } from './modpacks.controller';
import { ModpackInstallerService } from './modpack-installer.service';

describe('ModpacksController (RF-ARQ-18)', () => {
  let controller: ModpacksController;
  let mockInstallerService: any;

  beforeEach(() => {
    mockInstallerService = {
      installModpack: jest.fn().mockResolvedValue({
        taskId: 'task-modpack-123',
        status: 'QUEUED',
        message: 'Modpack installation started in the background',
      }),
    };

    controller = new ModpacksController(mockInstallerService as ModpackInstallerService);
  });

  it('GET /api/modpacks/search deve filtrar catálogo por texto e plataforma (RF-ARQ-18)', async () => {
    const res = await controller.searchModpacks('precision', 10, 'modrinth');

    expect(res.total).toBe(1);
    expect(res.results[0].id).toBe('fabric-precision-pack');
    expect(res.results[0].source).toBe('MODRINTH');
  });

  it('GET /api/modpacks/:id/versions deve retornar lista de versões disponíveis (RF-ARQ-18)', async () => {
    const versions = await controller.getVersions('fabric-precision-pack');

    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].gameVersion).toBe('1.20.1');
    expect(versions[0].loader).toBe('fabric');
  });

  it('POST /api/servers/:id/modpack/install deve delegar para o instalador e retornar 202 Accepted', async () => {
    const dto = {
      source: 'MODRINTH' as const,
      projectId: 'fabric-precision-pack',
      versionId: '1.0.0',
    };

    const res = await controller.installModpack('srv-1', dto);

    expect(mockInstallerService.installModpack).toHaveBeenCalledWith('srv-1', dto);
    expect(res.taskId).toBe('task-modpack-123');
    expect(res.status).toBe('QUEUED');
  });
});
