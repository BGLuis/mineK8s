import { BadRequestException } from '@nestjs/common';
import { MinecraftVersionsController } from './minecraft-versions.controller';
import { MinecraftVersionsService } from './minecraft-versions.service';

describe('MinecraftVersionsController', () => {
  let controller: MinecraftVersionsController;
  let mockService: jest.Mocked<Partial<MinecraftVersionsService>>;

  beforeEach(() => {
    mockService = {
      listVersions: jest.fn(),
    };
    controller = new MinecraftVersionsController(mockService as MinecraftVersionsService);
  });

  it('delegates to service with default snapshots=false', async () => {
    (mockService.listVersions as jest.Mock).mockResolvedValue([{ id: '26.3', kind: 'release' }]);

    const result = await controller.getVersions('VANILLA');

    expect(mockService.listVersions).toHaveBeenCalledWith('VANILLA', false);
    expect(result).toEqual([{ id: '26.3', kind: 'release' }]);
  });

  it('passes snapshots=true when query parameter is boolean or string true', async () => {
    (mockService.listVersions as jest.Mock).mockResolvedValue([
      { id: '26.4-snapshot-4', kind: 'snapshot' },
      { id: '26.3', kind: 'release' },
    ]);

    await controller.getVersions('VANILLA', 'true');
    expect(mockService.listVersions).toHaveBeenCalledWith('VANILLA', true);

    await controller.getVersions('VANILLA', true);
    expect(mockService.listVersions).toHaveBeenCalledWith('VANILLA', true);
  });

  it('throws BadRequestException when type query parameter is missing', async () => {
    await expect(controller.getVersions(undefined)).rejects.toThrow(BadRequestException);
    await expect(controller.getVersions('')).rejects.toThrow(BadRequestException);
  });
});
