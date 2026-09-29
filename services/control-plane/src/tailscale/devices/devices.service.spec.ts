import { NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';

describe('DevicesService', () => {
  let service: DevicesService;
  let mockDeviceRepo: any;
  let mockUserRepo: any;
  let mockServerRepo: any;
  let mockTailscaleCloudDriver: any;
  let mockConsoleDriver: any;
  let mockGatewayIpcService: any;

  beforeEach(() => {
    mockDeviceRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      save: jest.fn(async (entity) => entity),
    };

    mockUserRepo = {
      findOne: jest.fn(async () => null),
    };

    mockServerRepo = {
      find: jest.fn(async () => []),
    };

    mockTailscaleCloudDriver = {
      deleteDevice: jest.fn(async () => true),
    };

    mockConsoleDriver = {
      sendCommand: jest.fn(async () => 'Kicked player'),
    };

    mockGatewayIpcService = {
      revokePlayerSession: jest.fn(async () => ({ session_found: true, terminated_connections_count: 1 })),
    };

    service = new DevicesService(
      mockDeviceRepo,
      mockUserRepo,
      mockServerRepo,
      mockTailscaleCloudDriver,
      mockConsoleDriver,
      mockGatewayIpcService,
    );
  });

  describe('listDevices and getDeviceById', () => {
    it('deve listar todos os dispositivos', async () => {
      mockDeviceRepo.find.mockResolvedValue([
        { id: 'dev-1', tailscale_tag: 'tag:player-1', status: 'ACTIVE' },
      ]);

      const list = await service.listDevices();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('dev-1');
    });

    it('deve lançar NotFoundException se dispositivo não existir', async () => {
      mockDeviceRepo.findOne.mockResolvedValue(null);
      await expect(service.getDeviceById('dev-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeDevice (RF-TS-09 Nível 2: Ban de Rede Total)', () => {
    it('deve marcar dispositivo como REVOKED, disparar Smart Kick total e deletar nó na Cloud API', async () => {
      const mockDevice = {
        id: 'dev-target-1',
        node_id: 'node-ts-999',
        node_ip: '100.64.0.45',
        status: 'ACTIVE',
        user: {
          id: 'user-1',
          minecraft_nick: 'BadActor',
        },
      };

      mockDeviceRepo.findOne.mockResolvedValue(mockDevice);
      mockServerRepo.find.mockResolvedValue([
        { id: 'srv-survival', subdomain: 'survival' },
        { id: 'srv-creative', subdomain: 'creative' },
      ]);

      const result = await service.revokeDevice('dev-target-1');

      expect(result.deviceId).toBe('dev-target-1');
      expect(mockDevice.status).toBe('REVOKED');
      expect(mockDeviceRepo.save).toHaveBeenCalledWith(mockDevice);

      // Disparou Smart Kick em todos os servidores do cluster
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledTimes(2);
      expect(mockConsoleDriver.sendCommand).toHaveBeenCalledWith(
        expect.anything(),
        'kick BadActor Dispositivo banido da rede',
      );
      expect(mockGatewayIpcService.revokePlayerSession).toHaveBeenCalledTimes(2);

      // Removeu o nó da Tailnet Cloud API
      expect(mockTailscaleCloudDriver.deleteDevice).toHaveBeenCalledWith('node-ts-999');
    });
  });

  describe('cleanInactiveDevices (RF-TS-15 DeviceGarbageCollector)', () => {
    it('deve coletar e expurgar nós inativos > 30 dias na Cloud API', async () => {
      const inactiveNodes = [
        { id: 'dev-old-1', node_id: 'node-old-1', status: 'ACTIVE' },
        { id: 'dev-old-2', node_id: 'node-old-2', status: 'PENDING' },
      ];

      mockDeviceRepo.find.mockResolvedValue(inactiveNodes);

      const result = await service.cleanInactiveDevices(30);

      expect(result.removedCount).toBe(2);
      expect(mockTailscaleCloudDriver.deleteDevice).toHaveBeenCalledWith('node-old-1');
      expect(mockTailscaleCloudDriver.deleteDevice).toHaveBeenCalledWith('node-old-2');
      expect(inactiveNodes[0].status).toBe('REVOKED');
      expect(inactiveNodes[1].status).toBe('REVOKED');
    });
  });
});
