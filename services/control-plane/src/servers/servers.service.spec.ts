import { ConflictException, NotFoundException } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServersService } from './servers.service';
import { ServerType } from './dto/create-server.dto';

describe('ServersService', () => {
  let service: ServersService;
  let mockServerRepo: any;
  let mockSettingsRepo: any;
  let mockK8sService: any;

  let serversDb: Map<string, Server>;
  let settingsDb: Map<string, MinecraftServerSettings>;

  beforeEach(() => {
    serversDb = new Map();
    settingsDb = new Map();

    mockServerRepo = {
      create: jest.fn((dto) => ({
        id: '11111111-2222-3333-4444-555555555555',
        ...dto,
      })),
      save: jest.fn(async (entity) => {
        serversDb.set(entity.id || '11111111-2222-3333-4444-555555555555', entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        for (const s of serversDb.values()) {
          if (where.id && s.id === where.id) return s;
          if (where.subdomain && s.subdomain === where.subdomain) return s;
        }
        return null;
      }),
      find: jest.fn(async () => Array.from(serversDb.values())),
      remove: jest.fn(async (entity) => {
        serversDb.delete(entity.id);
        return entity;
      }),
    };

    mockSettingsRepo = {
      create: jest.fn((dto) => ({
        id: '99999999-8888-7777-6666-555555555555',
        ...dto,
      })),
      save: jest.fn(async (entity) => {
        settingsDb.set(entity.id || '99999999-8888-7777-6666-555555555555', entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        for (const s of settingsDb.values()) {
          if (where.server_id && s.server_id === where.server_id) return s;
        }
        return null;
      }),
    };

    mockK8sService = {
      provisionServer: jest.fn().mockResolvedValue(undefined),
      startServer: jest.fn().mockResolvedValue(undefined),
      stopServer: jest.fn().mockResolvedValue(undefined),
      deprovisionServer: jest.fn().mockResolvedValue(undefined),
      getServerDeployment: jest.fn().mockResolvedValue({
        replicas: 1,
        status: { readyReplicas: 1 },
      }),
      listDeployments: jest.fn().mockResolvedValue([
        {
          name: 'mc-hub',
          replicas: 1,
          status: { readyReplicas: 1 },
        },
      ]),
    };

    service = new ServersService(
      mockServerRepo as any,
      mockSettingsRepo as any,
      mockK8sService as any,
    );
  });

  describe('create (RF-ARQ-17, RF-MG-02)', () => {
    it('should create and provision a minecraft server', async () => {
      const result = await service.create({
        name: 'Hub Network',
        subdomain: 'hub',
        game_type: 'minecraft',
        routing_model: 'sni-shared-port',
        server_type: ServerType.PAPER,
        game_version: '1.20.4',
        allocated_memory_mb: 4096,
      });

      expect(result.subdomain).toBe('hub');
      expect(result.status).toBe('STOPPED');
      expect(mockK8sService.provisionServer).toHaveBeenCalled();
      expect(serversDb.size).toBe(1);
      expect(settingsDb.size).toBe(1);
    });

    it('should throw ConflictException if subdomain already exists', async () => {
      serversDb.set('1', {
        id: '1',
        subdomain: 'hub',
      } as any);

      await expect(
        service.create({
          name: 'Another Hub',
          subdomain: 'hub',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('start & stop', () => {
    it('should start server and update state to STARTING', async () => {
      const server: Server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any;
      serversDb.set('srv-1', server);

      const res = await service.start('srv-1');
      expect(res.message).toBe('Instância iniciando');
      expect(mockK8sService.startServer).toHaveBeenCalledWith(server);
      expect(server.state).toBe('STARTING');
    });

    it('should stop server and update state to STOPPED', async () => {
      const server: Server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'READY',
      } as any;
      serversDb.set('srv-1', server);

      const res = await service.stop('srv-1');
      expect(res.message).toBe('Instância parando');
      expect(mockK8sService.stopServer).toHaveBeenCalledWith(server);
      expect(server.state).toBe('STOPPED');
    });
  });

  describe('delete', () => {
    it('should deprovision k8s resources and delete server record', async () => {
      const server: Server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any;
      serversDb.set('srv-1', server);

      const res = await service.delete('srv-1');
      expect(res.message).toBe('Instância removida');
      expect(mockK8sService.deprovisionServer).toHaveBeenCalledWith(server);
      expect(mockServerRepo.remove).toHaveBeenCalledWith(server);
    });
  });

  describe('updateDomain', () => {
    it('should update subdomain when not taken', async () => {
      const server: Server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
      } as any;
      serversDb.set('srv-1', server);

      const res = await service.updateDomain('srv-1', 'lobby-new');
      expect(res.message).toBe('Domínio atualizado');
      expect(server.subdomain).toBe('lobby-new');
    });

    it('should throw ConflictException if domain is taken by another server', async () => {
      serversDb.set('srv-1', { id: 'srv-1', subdomain: 'hub' } as any);
      serversDb.set('srv-2', { id: 'srv-2', subdomain: 'lobby' } as any);

      await expect(service.updateDomain('srv-1', 'lobby')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
