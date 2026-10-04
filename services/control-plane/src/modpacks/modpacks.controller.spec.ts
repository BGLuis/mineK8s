import { BadRequestException } from '@nestjs/common';
import { ModpacksController } from './modpacks.controller';
import { ModpackInstallerService } from './modpack-installer.service';
import { ModpackCatalogService } from './modpack-catalog.service';

describe('ModpacksController (RF-ARQ-18)', () => {
  let controller: ModpacksController;
  let mockInstallerService: any;
  let mockCatalogService: any;

  beforeEach(() => {
    mockInstallerService = {
      installModpack: jest.fn().mockResolvedValue({
        taskId: 'task-modpack-123',
        status: 'QUEUED',
        message: 'Modpack installation started in the background',
      }),
    };
    mockCatalogService = {
      search: jest.fn().mockResolvedValue({ total: 0, offset: 0, limit: 20, results: [] }),
      getVersions: jest.fn().mockResolvedValue([]),
    };

    controller = new ModpacksController(
      mockInstallerService as ModpackInstallerService,
      mockCatalogService as ModpackCatalogService,
    );
  });

  it('GET /api/modpacks/search delega ao catálogo real com paginação e fonte normalizada', async () => {
    await controller.searchModpacks('all the mods', 10, 'MODRINTH', 20);

    expect(mockCatalogService.search).toHaveBeenCalledWith({
      query: 'all the mods',
      limit: 10,
      offset: 20,
      source: 'modrinth',
    });
  });

  it('GET /api/modpacks/search rejeita fonte desconhecida em vez de ignorá-la', async () => {
    await expect(controller.searchModpacks('x', 10, 'ftb')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCatalogService.search).not.toHaveBeenCalled();
  });

  it('GET /api/modpacks/search repassa ordenação e filtros normalizados', async () => {
    await controller.searchModpacks(undefined, undefined, undefined, undefined, 'Downloads', '1.20.1', 'Fabric', 'Adventure');

    expect(mockCatalogService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'downloads',
        gameVersion: '1.20.1',
        loader: 'fabric',
        category: 'adventure',
      }),
    );
  });

  it.each([
    ['sort', [undefined, undefined, undefined, undefined, 'newest']],
    ['loader', [undefined, undefined, undefined, undefined, undefined, undefined, 'liteloader']],
    ['gameVersion', [undefined, undefined, undefined, undefined, undefined, '1.20"],["x']],
    ['category', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'a b']],
  ])('GET /api/modpacks/search rejeita %s inválido em vez de ignorá-lo', async (_name, args) => {
    await expect((controller.searchModpacks as any)(...args)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCatalogService.search).not.toHaveBeenCalled();
  });

  it('GET /api/modpacks/:id/versions delega ao catálogo com a fonte informada pela SPA', async () => {
    await controller.getVersions('AANobbMI', 'modrinth');

    expect(mockCatalogService.getVersions).toHaveBeenCalledWith('AANobbMI', 'modrinth');
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
