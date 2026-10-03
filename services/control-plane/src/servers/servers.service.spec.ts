import { ConflictException, NotFoundException } from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServersService } from './servers.service';
import { ServerType } from './dto/create-server.dto';

describe('ServersService', () => {
  let service: ServersService;
  let mockServerRepo: any;
  let mockSettingsRepo: any;
  let mockAuditRepo: any;
  let mockK8sService: any;
  let mockBackupService: any;
  let mockGatewayIpcService: any;
  let mockSlpProbeService: any;

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
      restartServer: jest.fn().mockResolvedValue(undefined),
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

    const mockConsoleDriver = {
      sendCommand: jest.fn().mockResolvedValue('Command output'),
      listPlayers: jest.fn().mockResolvedValue(['Steve']),
      saveOff: jest.fn().mockResolvedValue('OK'),
      saveFlush: jest.fn().mockResolvedValue('OK'),
      saveOn: jest.fn().mockResolvedValue('OK'),
    };

    mockAuditRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    };

    const mockLogStreamer = {
      getBuffer: jest.fn().mockReturnValue({
        getHistory: jest.fn().mockReturnValue([
          { id: '1', timestamp: '12:00:00', level: 'INFO', message: 'Server initialized' },
        ]),
      }),
    };

    mockBackupService = {
      createPreUpdateBackup: jest.fn().mockResolvedValue('/tmp/backup-test-123'),
      restorePreUpdateBackup: jest.fn().mockResolvedValue(undefined),
      purgeModsDirectory: jest.fn().mockResolvedValue(undefined),
    };

    mockGatewayIpcService = {
      broadcastRouteUpdate: jest.fn(),
      publishRoute: jest.fn().mockResolvedValue(undefined),
    };

    mockSlpProbeService = {
      probe: jest.fn().mockResolvedValue({ ready: true }),
    };

    const mockDnsDriver = {
      upsertSrvRecord: jest.fn().mockResolvedValue({ id: 'rec-srv-1' }),
      deleteRecordByNameAndType: jest.fn().mockResolvedValue(true),
      getRootDomain: jest.fn().mockReturnValue('minek8s.net'),
    };

    service = new ServersService(
      mockServerRepo as any,
      mockSettingsRepo as any,
      mockAuditRepo as any,
      mockK8sService as any,
      mockConsoleDriver as any,
      mockLogStreamer as any,
      mockBackupService as any,
      mockGatewayIpcService as any,
      mockSlpProbeService as any,
      mockDnsDriver as any,
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
      expect(res.message).toBe('Instance starting');
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
      expect(res.message).toBe('Instance stopping');
      expect(mockK8sService.stopServer).toHaveBeenCalledWith(server);
      expect(server.state).toBe('STOPPED');
    });
  });

  describe('restart', () => {
    it('reinicia servidor READY com shutdown gracioso e termina em STARTING', async () => {
      const server: Server = { id: 'srv-1', name: 'Hub', subdomain: 'hub', state: 'READY' } as any;
      serversDb.set('srv-1', server);

      const res = await service.restart('srv-1');

      expect(res.message).toBe('Instance restarting');
      expect(mockK8sService.restartServer).toHaveBeenCalledWith(server);
      expect(server.state).toBe('STARTING');
    });

    it('recusa reiniciar servidor parado, que deveria ser iniciado', async () => {
      serversDb.set('srv-1', { id: 'srv-1', subdomain: 'hub', state: 'STOPPED' } as any);

      await expect(service.restart('srv-1')).rejects.toThrow(/Only a running server can be restarted/);
      expect(mockK8sService.restartServer).not.toHaveBeenCalled();
    });

    it('responde 404 para servidor inexistente', async () => {
      await expect(service.restart('nope')).rejects.toThrow(/not found/);
    });
  });

  describe('update (PATCH /api/servers/:id)', () => {
    const seed = (overrides: Partial<Server> = {}) => {
      const server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'READY',
        access_policy: 'GROUP',
        is_maintenance: false,
        auto_wake: true,
        sleep_timeout_minutes: 15,
        ...overrides,
      } as any;
      serversDb.set('srv-1', server);
      return server;
    };

    it('grava os campos enviados, preserva os demais e republica a rota no Gateway', async () => {
      const server = seed();

      await service.update('srv-1', { is_maintenance: true, sleep_timeout_minutes: 30 });

      expect(server).toMatchObject({ is_maintenance: true, sleep_timeout_minutes: 30, auto_wake: true });
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-1');
    });

    it('não derruba o PATCH se o Gateway estiver indisponível', async () => {
      seed();
      mockGatewayIpcService.publishRoute.mockRejectedValue(new Error('stream fechado'));

      await expect(service.update('srv-1', { auto_wake: false })).resolves.toBeDefined();
    });

    it('recusa corpo vazio', async () => {
      seed();

      await expect(service.update('srv-1', {})).rejects.toThrow(/at least one field/);
    });

    it('recusa mudar a política de um servidor publicado na internet', async () => {
      seed({ access_policy: 'INTERNET' });

      await expect(service.update('srv-1', { access_policy: 'GROUP' })).rejects.toThrow(/unpublish it/);
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
      expect(res.message).toBe('Instance removed');
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
      expect(res.message).toBe('Domain updated');
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

  describe('sendCommand (RF-RCON-03, RF-MG-05)', () => {
    it('should dispatch command via ConsoleDriver', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        subdomain: 'survival',
      } as any);

      const result = await service.sendCommand('srv-1', 'time set day');
      expect(result.success).toBe(true);
      expect(result.response).toBe('Command output');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: 'srv-1',
          command: 'time set day',
          execution_source: 'REST_API',
        }),
      );
    });

    it('should throw NotFoundException if server does not exist', async () => {
      await expect(
        service.sendCommand('srv-missing', 'time set day'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLogs (RF-RCON-07, RF-RCON-08)', () => {
    it('should return formatted logs and parsed lines from buffer', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        subdomain: 'survival',
        state: 'READY',
      } as any);

      const result = await service.getLogs('srv-1', 50);
      expect(result.lines).toHaveLength(1);
      expect(result.logs).toContain('Server initialized');
    });

    it('should throw NotFoundException if server does not exist', async () => {
      await expect(service.getLogs('srv-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateVersion (RF-STO-13 - Pre-Update Backup, Purge & Rollback)', () => {
    beforeEach(() => {
      serversDb.set('srv-update-1', {
        id: 'srv-update-1',
        name: 'Survival Server',
        subdomain: 'survival',
        state: 'READY',
        game_version: '1.20.4',
        server_type: 'PAPER',
        modpack_id: 'atm9',
        allocated_port: 25565,
      } as any);
    });

    it('should update server version successfully with pre-update backup and purge of mods (RF-STO-13)', async () => {
      const result = await service.updateVersion('srv-update-1', {
        game_version: '1.20.5',
        purge_mods: true,
      });

      expect(mockK8sService.stopServer).toHaveBeenCalled();
      expect(mockBackupService.createPreUpdateBackup).toHaveBeenCalled();
      expect(mockBackupService.purgeModsDirectory).toHaveBeenCalled();
      expect(mockK8sService.provisionServer).toHaveBeenCalled();
      expect(mockK8sService.startServer).toHaveBeenCalled();

      const server = serversDb.get('srv-update-1')!;
      expect(server.game_version).toBe('1.20.5');
      expect(server.state).toBe('READY');
      expect(result.rolledBack).toBe(false);

      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'UPDATING' }),
      );
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'READY' }),
      );
    });

    it('should trigger automated rollback when boot of new version fails (RF-STO-13)', async () => {
      mockSlpProbeService.probe.mockResolvedValueOnce({ ready: false });

      const result = await service.updateVersion('srv-update-1', {
        game_version: '1.21.0',
        purge_mods: true,
      });

      expect(mockBackupService.restorePreUpdateBackup).toHaveBeenCalled();

      const server = serversDb.get('srv-update-1')!;
      expect(server.game_version).toBe('1.20.4'); // Restaurado para versão original
      expect(server.state).toBe('READY');
      expect(result.rolledBack).toBe(true);
      expect(result.version).toBe('1.20.4');
    });

    it('should reject update with ConflictException if server is already in UPDATING state', async () => {
      const server = serversDb.get('srv-update-1')!;
      server.state = 'UPDATING';

      await expect(
        service.updateVersion('srv-update-1', { game_version: '1.21.0' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Public Worlds & Cloudflare Exposure (RF-CF-01, RF-CF-02, RF-CF-07)', () => {
    it('deve forçar online_mode=true ao criar um servidor com access_policy INTERNET (RF-CF-02)', async () => {
      const res = await service.create({
        name: 'Public World',
        subdomain: 'public-world',
        access_policy: 'INTERNET',
        minecraft_settings: {
          online_mode: false, // Mesmo passando false, deve ser forçado a true
        },
      });

      const server = serversDb.get(res.id)!;
      expect(server.access_policy).toBe('INTERNET');
      const settings = Array.from(settingsDb.values()).find((s) => s.server_id === server.id)!;
      expect(settings.online_mode).toBe(true);
    });

    it('deve publicar servidor (publishServer), criando SRV no Cloudflare e forçando online_mode=true', async () => {
      const server = mockServerRepo.create({
        id: 'srv-pub-1',
        name: 'Survival Public',
        subdomain: 'survival-pub',
        state: 'READY',
        access_policy: 'GROUP',
      });
      serversDb.set(server.id, server);

      const settings = mockSettingsRepo.create({
        id: 'set-pub-1',
        server_id: server.id,
        online_mode: false,
      });
      settingsDb.set(server.id, settings);
      server.minecraft_settings = settings;

      const result = await service.publishServer('srv-pub-1');

      expect(result.access_policy).toBe('INTERNET');
      expect(result.online_mode).toBe(true);
      expect(result.srv_record).toContain('_minecraft._tcp.survival-pub.minek8s.net');
      expect(settings.online_mode).toBe(true);
      expect(server.access_policy).toBe('INTERNET');
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          access_policy: 'INTERNET',
          subdomain: 'survival-pub',
        }),
      );
    });

    it('deve despublicar servidor (unpublishServer), removendo SRV e restaurando access_policy para GROUP', async () => {
      const server = mockServerRepo.create({
        id: 'srv-pub-2',
        name: 'Survival Public 2',
        subdomain: 'survival-pub2',
        state: 'READY',
        access_policy: 'INTERNET',
      });
      serversDb.set(server.id, server);

      const result = await service.unpublishServer('srv-pub-2');

      expect(result.access_policy).toBe('GROUP');
      expect(server.access_policy).toBe('GROUP');
      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          access_policy: 'GROUP',
          subdomain: 'survival-pub2',
        }),
      );
    });
  });
});
