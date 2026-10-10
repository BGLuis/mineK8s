import { PlayerSessionsService } from '../gateway-ipc/player-sessions.service';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ServersService } from './servers.service';
import { ServerType } from './dto/create-server.dto';
import { RouteAction } from '../gateway-ipc/gateway-ipc.interfaces';

describe('ServersService', () => {
  let service: ServersService;
  let mockServerRepo: any;
  let mockSettingsRepo: any;
  let mockAuditRepo: any;
  let mockK8sService: any;
  let mockBackupService: any;
  let mockGatewayIpcService: any;
  let mockSlpProbeService: any;
  let mockRuntimeResolver: any;
  let playerSessions: PlayerSessionsService;
  let mockNodeMetrics: { assertDiskAllowsCreation: jest.Mock };

  const runtimeFor = (version: string) => ({
    java_version: version.startsWith('26.') ? 25 : 21,
    server_jar_url: `https://fill-data.papermc.io/v1/objects/abc/paper-${version}.jar`,
    server_jar_checksum: `sha256:${version}`,
    server_build: '132',
    server_build_channel: 'STABLE',
  });

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
          if (where.resource_name && s.resource_name === where.resource_name) return s;
        }
        return null;
      }),
      find: jest.fn(async () => Array.from(serversDb.values())),
      update: jest.fn(async (id: string, partial: Partial<Server>) => {
        Object.assign(serversDb.get(id)!, partial);
      }),
      // TypeORM clears the primary key of the entity it removes.
      remove: jest.fn(async (entity) => {
        serversDb.delete(entity.id);
        delete entity.id;
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
      applyDeployment: jest.fn().mockResolvedValue(undefined),
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
        getHistory: jest
          .fn()
          .mockReturnValue([
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
      routeTarget: jest.fn(
        (server: any) => `mc-${server.resource_name}.minekubernetes.svc.cluster.local:25565`,
      ),
    };

    mockSlpProbeService = {
      probe: jest.fn().mockResolvedValue({ ready: true }),
    };

    const mockDnsDriver = {
      upsertSrvRecord: jest.fn().mockResolvedValue({ id: 'rec-srv-1' }),
      deleteRecordByNameAndType: jest.fn().mockResolvedValue(true),
      getRootDomain: jest.fn().mockReturnValue('minek8s.net'),
    };

    mockRuntimeResolver = {
      resolve: jest.fn(async (_type: string, version: string) => runtimeFor(version)),
    };

    playerSessions = new PlayerSessionsService();
    mockNodeMetrics = { assertDiskAllowsCreation: jest.fn().mockResolvedValue(undefined) };

    service = new ServersService(
      mockServerRepo as any,
      mockSettingsRepo as any,
      mockAuditRepo as any,
      mockK8sService as any,
      mockConsoleDriver as any,
      mockLogStreamer as any,
      mockRuntimeResolver as any,
      mockBackupService as any,
      mockGatewayIpcService as any,
      mockSlpProbeService as any,
      mockDnsDriver as any,
      playerSessions,
      mockNodeMetrics as any,
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

    it('publishes the route to the gateway once the server is provisioned, since the gateway ignores status changes for routes it does not know', async () => {
      const result = await service.create({ name: 'Hub', subdomain: 'hub' });

      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith(result.id);
      const [provisionOrder] = mockK8sService.provisionServer.mock.invocationCallOrder;
      const [publishOrder] = mockGatewayIpcService.publishRoute.mock.invocationCallOrder;
      expect(publishOrder).toBeGreaterThan(provisionOrder);
    });

    it('does not publish a route for a server whose provisioning failed', async () => {
      mockK8sService.provisionServer.mockRejectedValueOnce(new Error('quota exceeded'));

      await expect(service.create({ name: 'Hub', subdomain: 'hub' })).rejects.toThrow(
        'quota exceeded',
      );

      expect(mockGatewayIpcService.publishRoute).not.toHaveBeenCalled();
    });

    it('still creates the server when the gateway is unreachable', async () => {
      mockGatewayIpcService.publishRoute.mockRejectedValue(new Error('stream fechado'));

      const result = await service.create({ name: 'Hub', subdomain: 'hub' });

      expect(result.status).toBe('STOPPED');
    });

    it('refuses to create when the disk is full, before saving anything or touching k8s', async () => {
      const diskFull = new HttpException({ code: 'DISK_USAGE_BLOCKED', message: 'full' }, 507);
      mockNodeMetrics.assertDiskAllowsCreation.mockRejectedValue(diskFull);

      await expect(
        service.create({ name: 'Hub', subdomain: 'hub', allocated_memory_mb: 4096 }),
      ).rejects.toBe(diskFull);

      expect(mockServerRepo.save).not.toHaveBeenCalled();
      expect(mockK8sService.provisionServer).not.toHaveBeenCalled();
    });

    it('should store the runtime resolved for the type and version, so the Deployment never needs the network', async () => {
      await service.create({
        name: 'Vanilla',
        subdomain: 'vanilla',
        server_type: ServerType.VANILLA,
        game_version: '1.21.1',
      });

      expect(mockRuntimeResolver.resolve).toHaveBeenCalledWith('VANILLA', '1.21.1');
      const provisioned = mockK8sService.provisionServer.mock.calls[0][0];
      expect(provisioned).toMatchObject(runtimeFor('1.21.1'));
    });

    it('should refuse a version the resolver rejects before saving or provisioning anything', async () => {
      mockRuntimeResolver.resolve.mockRejectedValueOnce(
        new BadRequestException('Minecraft 1.0 has no dedicated server jar'),
      );

      await expect(
        service.create({
          name: 'Old',
          subdomain: 'old',
          server_type: ServerType.VANILLA,
          game_version: '1.0',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(serversDb.size).toBe(0);
      expect(mockK8sService.provisionServer).not.toHaveBeenCalled();
    });

    it('uses the subdomain as the stable resource name of a new server', async () => {
      await service.create({ name: 'Hub', subdomain: 'hub' });

      const saved = [...serversDb.values()][0];
      expect(saved.resource_name).toBe('hub');
      expect(mockK8sService.provisionServer.mock.calls[0][0].resource_name).toBe('hub');
    });

    it('does not reuse the resource name of a server that was renamed away from that subdomain', async () => {
      serversDb.set('old', { id: 'old', subdomain: 'hub-novo', resource_name: 'hub' } as any);

      const result = await service.create({ name: 'New Hub', subdomain: 'hub' });

      const created = [...serversDb.values()].find((s) => s.subdomain === 'hub')!;
      expect(result.subdomain).toBe('hub');
      expect(created.resource_name).not.toBe('hub');
      expect(created.resource_name).toMatch(/^hub-[0-9a-f]{6}$/);
      expect(mockK8sService.provisionServer.mock.calls[0][0].resource_name).toBe(
        created.resource_name,
      );
    });

    it.each([60, 63])(
      'keeps a disambiguated resource name within the Service name limit for a %i-character subdomain',
      async (length) => {
        const subdomain = 'a'.repeat(length);
        serversDb.set('old', { id: 'old', subdomain: 'outro', resource_name: subdomain } as any);

        await service.create({ name: 'Long', subdomain });

        const created = [...serversDb.values()].find((s) => s.subdomain === subdomain)!;
        expect(created.resource_name).not.toBe(subdomain);
        expect(created.resource_name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
        expect(`mc-${created.resource_name}`.length).toBeLessThanOrEqual(63);
      },
    );

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

  describe('o Gateway é avisado das mudanças de estado feitas pelo painel', () => {
    const statusEvents = () =>
      mockGatewayIpcService.broadcastRouteUpdate.mock.calls.map(([event]: any) => event);

    it('stop manda STOPPED, para o Gateway acordar o mundo em vez de proxiar para um pod que não existe', async () => {
      serversDb.set('srv-1', { id: 'srv-1', name: 'Hub', subdomain: 'hub', state: 'READY' } as any);

      await service.stop('srv-1');

      expect(statusEvents()).toEqual([
        expect.objectContaining({
          action: RouteAction.STATUS_CHANGE,
          server_id: 'srv-1',
          status: 'STOPPED',
        }),
      ]);
    });

    it('start manda STARTING', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any);

      await service.start('srv-1');

      expect(statusEvents()).toEqual([
        expect.objectContaining({ server_id: 'srv-1', status: 'STARTING' }),
      ]);
    });

    it('restart termina avisando STARTING', async () => {
      serversDb.set('srv-1', { id: 'srv-1', name: 'Hub', subdomain: 'hub', state: 'READY' } as any);

      await service.restart('srv-1');

      expect(statusEvents().at(-1)).toMatchObject({ server_id: 'srv-1', status: 'STARTING' });
    });

    it('um start que já estava em andamento não avisa nada', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STARTING',
      } as any);

      await service.start('srv-1');

      expect(statusEvents()).toEqual([]);
    });
  });

  describe('jogadores online', () => {
    const connect = (sessionId: string, nick: string) =>
      playerSessions.connected({
        event_type: 0,
        session_id: sessionId,
        server_id: 'srv-1',
        client_ip: '100.64.0.2',
        minecraft_nick: nick,
        timestamp_epoch_ms: Date.parse('2026-10-03T12:00:00Z'),
        reason: '',
      });

    beforeEach(() => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'READY',
        minecraft_settings: { max_players: 10 },
      } as any);
    });

    it('getPlayers devolve nick, IP e início da sessão, com o limite de vagas do servidor', async () => {
      connect('s1', 'Steve');

      await expect(service.getPlayers('srv-1')).resolves.toEqual({
        online: 1,
        max: 10,
        players: [
          { nick: 'Steve', ip: '100.64.0.2', connectedAt: new Date('2026-10-03T12:00:00Z') },
        ],
      });
    });

    it('getPlayers responde 404 para servidor inexistente', async () => {
      await expect(service.getPlayers('nope')).rejects.toThrow(/not found/);
    });

    it('findOne e findAll trazem players_online', async () => {
      connect('s1', 'Steve');
      connect('s2', 'Alex');

      expect((await service.findOne('srv-1')).players_online).toBe(2);
      expect((await service.findAll()).find((s) => s.id === 'srv-1')?.players_online).toBe(2);
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

      await expect(service.restart('srv-1')).rejects.toThrow(
        /Only a running server can be restarted/,
      );
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

      expect(server).toMatchObject({
        is_maintenance: true,
        sleep_timeout_minutes: 30,
        auto_wake: true,
      });
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

      await expect(service.update('srv-1', { access_policy: 'GROUP' })).rejects.toThrow(
        /unpublish it/,
      );
    });

    it('nova memória num servidor parado só reescreve o Deployment, sem ligá-lo', async () => {
      const server = seed({ state: 'STOPPED', allocated_memory_mb: 4096 });

      await service.update('srv-1', { allocated_memory_mb: 6144 });

      expect(mockK8sService.applyDeployment).toHaveBeenCalledWith(
        expect.objectContaining({ allocated_memory_mb: 6144, state: 'STOPPED' }),
        undefined,
      );
      expect(mockK8sService.stopServer).not.toHaveBeenCalled();
      expect(server.state).toBe('STOPPED');
    });

    it('nova memória num servidor ligado faz parada graciosa antes de subir o Deployment novo', async () => {
      const server = seed({ state: 'READY', allocated_memory_mb: 4096 });
      const calls: string[] = [];
      mockK8sService.stopServer.mockImplementation(async (s: Server) => {
        calls.push(`stop:${s.state}`);
      });
      mockK8sService.applyDeployment.mockImplementation(async (s: Server) => {
        calls.push(`apply:${s.state}:${s.allocated_memory_mb}`);
      });

      await service.update('srv-1', { allocated_memory_mb: 8192 });

      // stopServer só faz save-all/stop por RCON quando o estado é READY ou STOPPING.
      expect(calls).toEqual(['stop:STOPPING', 'apply:STARTING:8192']);
      expect(server.state).toBe('STARTING');
    });

    it('memória igual à atual não reinicia o servidor', async () => {
      seed({ state: 'READY', allocated_memory_mb: 4096 });

      await service.update('srv-1', { allocated_memory_mb: 4096, auto_wake: false });

      expect(mockK8sService.applyDeployment).not.toHaveBeenCalled();
      expect(mockK8sService.stopServer).not.toHaveBeenCalled();
    });

    it.each(['STARTING', 'STOPPING', 'UPDATING', 'PROVISIONING', 'FAILED'])(
      'recusa trocar a memória em %s, sem gravar nada',
      async (state) => {
        const server = seed({ state: state as any, allocated_memory_mb: 4096 });

        await expect(service.update('srv-1', { allocated_memory_mb: 8192 })).rejects.toThrow(
          ConflictException,
        );
        expect(server.allocated_memory_mb).toBe(4096);
        expect(mockK8sService.applyDeployment).not.toHaveBeenCalled();
      },
    );
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

    it('tells the gateway to drop the route so the removed server stops resolving', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any);

      await service.delete('srv-1');

      expect(mockGatewayIpcService.broadcastRouteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ action: RouteAction.DELETE, server_id: 'srv-1' }),
      );
    });

    it('keeps the route when the k8s resources could not be removed', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any);
      mockK8sService.deprovisionServer.mockRejectedValue(new Error('apiserver down'));

      await expect(service.delete('srv-1')).rejects.toThrow('apiserver down');

      expect(mockGatewayIpcService.broadcastRouteUpdate).not.toHaveBeenCalled();
    });

    it('still deletes the server when the gateway is unreachable', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'STOPPED',
      } as any);
      mockGatewayIpcService.broadcastRouteUpdate.mockImplementation(() => {
        throw new Error('stream fechado');
      });

      await expect(service.delete('srv-1')).resolves.toEqual({ message: 'Instance removed' });
    });
  });

  describe('updateSettings (PATCH /api/servers/:id/settings)', () => {
    const seed = (overrides: Partial<Server> = {}) => {
      const settings = {
        id: 'set-1',
        server_id: 'srv-1',
        motd: 'Antigo',
        max_players: 20,
        online_mode: false,
        rcon_password: 'segredo-rcon',
      };
      const server = {
        id: 'srv-1',
        name: 'Hub',
        subdomain: 'hub',
        state: 'READY',
        access_policy: 'GROUP',
        minecraft_settings: settings,
        ...overrides,
      } as any;
      serversDb.set('srv-1', server);
      return { server, settings };
    };

    it('grava só os campos enviados e devolve o servidor com as configurações novas', async () => {
      const { settings } = seed();

      const detail = await service.updateSettings('srv-1', { motd: 'Novo', max_players: 8 });

      expect(settings).toMatchObject({ motd: 'Novo', max_players: 8, online_mode: false });
      expect(mockSettingsRepo.save).toHaveBeenCalledWith(settings);
      expect(detail.settings).toMatchObject({ motd: 'Novo', max_players: 8 });
    });

    it('nunca devolve a senha do RCON', async () => {
      seed();

      const detail = await service.updateSettings('srv-1', { motd: 'Novo' });

      expect(JSON.stringify(detail)).not.toContain('segredo-rcon');
    });

    it('recusa trocar a senha do RCON: o servidor em execução continuaria com a antiga', async () => {
      seed();

      await expect(
        service.updateSettings('srv-1', { rcon_password: 'outra-senha' }),
      ).rejects.toThrow(/RCON password/);
    });

    it('recusa corpo vazio', async () => {
      seed();

      await expect(service.updateSettings('srv-1', {})).rejects.toThrow(/at least one field/);
    });

    it('recusa desligar o online-mode de um servidor publicado na internet', async () => {
      seed({ access_policy: 'INTERNET' });

      await expect(service.updateSettings('srv-1', { online_mode: false })).rejects.toThrow(
        /published/,
      );
    });

    it('404 para servidor inexistente', async () => {
      await expect(service.updateSettings('nope', { motd: 'x' })).rejects.toThrow(/not found/);
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

    it('keeps the Kubernetes resource name, so the server keeps its Deployment, Service and PVC', async () => {
      const server: Server = { id: 'srv-1', subdomain: 'hub', resource_name: 'hub' } as any;
      serversDb.set('srv-1', server);

      await service.updateDomain('srv-1', 'lobby-new');

      expect(server.resource_name).toBe('hub');
      expect(mockK8sService.provisionServer).not.toHaveBeenCalled();
      expect(mockK8sService.deprovisionServer).not.toHaveBeenCalled();
    });

    it('lists the replicas of a server whose subdomain changed from its own Deployment', async () => {
      serversDb.set('srv-1', {
        id: 'srv-1',
        subdomain: 'lobby-new',
        resource_name: 'hub',
      } as any);

      const [summary] = await service.findAll();

      expect(summary.replicas).toBe(1);
      expect(summary.ready_replicas).toBe(1);
    });

    it('should throw ConflictException if domain is taken by another server', async () => {
      serversDb.set('srv-1', { id: 'srv-1', subdomain: 'hub' } as any);
      serversDb.set('srv-2', { id: 'srv-2', subdomain: 'lobby' } as any);

      await expect(service.updateDomain('srv-1', 'lobby')).rejects.toThrow(ConflictException);
    });

    it('republishes the route so the gateway serves the new subdomain', async () => {
      serversDb.set('srv-1', { id: 'srv-1', name: 'Hub', subdomain: 'hub' } as any);

      await service.updateDomain('srv-1', 'lobby-new');

      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith('srv-1');
    });

    it('does not republish when the new subdomain is taken', async () => {
      serversDb.set('srv-1', { id: 'srv-1', subdomain: 'hub' } as any);
      serversDb.set('srv-2', { id: 'srv-2', subdomain: 'lobby' } as any);

      await expect(service.updateDomain('srv-1', 'lobby')).rejects.toThrow(ConflictException);

      expect(mockGatewayIpcService.publishRoute).not.toHaveBeenCalled();
    });

    it('still updates the domain when the gateway is unreachable', async () => {
      serversDb.set('srv-1', { id: 'srv-1', name: 'Hub', subdomain: 'hub' } as any);
      mockGatewayIpcService.publishRoute.mockRejectedValue(new Error('stream fechado'));

      await expect(service.updateDomain('srv-1', 'lobby-new')).resolves.toEqual({
        message: 'Domain updated',
      });
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
      await expect(service.sendCommand('srv-missing', 'time set day')).rejects.toThrow(
        NotFoundException,
      );
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
      await expect(service.getLogs('srv-missing')).rejects.toThrow(NotFoundException);
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

    it('should start the new version on its own jar and Java, and the old ones after a rollback (#156)', async () => {
      Object.assign(serversDb.get('srv-update-1')!, runtimeFor('1.21.11'));
      const startedWith: { java: number | null; jar: string | null }[] = [];
      mockK8sService.startServer.mockImplementation(async (s: Server) => {
        startedWith.push({ java: s.java_version, jar: s.server_jar_url });
      });
      mockSlpProbeService.probe.mockResolvedValueOnce({ ready: false });

      await service.updateVersion('srv-update-1', { game_version: '26.2' });

      expect(mockRuntimeResolver.resolve).toHaveBeenCalledWith('PAPER', '26.2');
      expect(startedWith).toEqual([
        { java: 25, jar: runtimeFor('26.2').server_jar_url },
        { java: 21, jar: runtimeFor('1.21.11').server_jar_url },
      ]);
      expect(serversDb.get('srv-update-1')).toMatchObject(runtimeFor('1.21.11'));
    });

    it('should keep the server untouched when the new version cannot be resolved', async () => {
      mockRuntimeResolver.resolve.mockRejectedValueOnce(
        new BadRequestException('Paper has no STABLE build for Minecraft 26.3 yet'),
      );

      await expect(service.updateVersion('srv-update-1', { game_version: '26.3' })).rejects.toThrow(
        BadRequestException,
      );

      const server = serversDb.get('srv-update-1')!;
      expect(server.state).toBe('READY');
      expect(server.game_version).toBe('1.20.4');
      expect(mockK8sService.stopServer).not.toHaveBeenCalled();
      expect(mockBackupService.createPreUpdateBackup).not.toHaveBeenCalled();
    });

    it('should reject update with ConflictException if server is already in UPDATING state', async () => {
      const server = serversDb.get('srv-update-1')!;
      server.state = 'UPDATING';

      await expect(
        service.updateVersion('srv-update-1', { game_version: '1.21.0' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('runtime de servidores criados antes da resolução', () => {
    it('resolves the servers without a Java version and keeps going past a failure', async () => {
      serversDb.set('legacy-1', {
        id: 'legacy-1',
        subdomain: 'legacy-one',
        game_type: 'minecraft',
        server_type: 'PAPER',
        game_version: '26.3',
        java_version: null,
      } as any);
      serversDb.set('legacy-2', {
        id: 'legacy-2',
        subdomain: 'legacy-two',
        game_type: 'minecraft',
        server_type: 'VANILLA',
        game_version: '1.21.1',
        java_version: null,
        state: 'READY',
      } as any);
      mockRuntimeResolver.resolve.mockRejectedValueOnce(new BadRequestException('no STABLE build'));

      await (service as any).backfillRuntimes();

      expect(mockServerRepo.find).toHaveBeenCalledWith({
        where: { game_type: 'minecraft', java_version: expect.anything() },
      });
      expect(serversDb.get('legacy-1')!.java_version).toBeNull();
      expect(serversDb.get('legacy-2')).toMatchObject({ ...runtimeFor('1.21.1'), state: 'READY' });
      expect(mockK8sService.startServer).not.toHaveBeenCalled();
    });
  });

  describe('findOne: build instalado (#157)', () => {
    it('exposes the Java version, build number and channel of the server', async () => {
      serversDb.set('srv-build', {
        id: 'srv-build',
        subdomain: 'build',
        state: 'STOPPED',
        ...runtimeFor('1.21.11'),
      } as any);

      await expect(service.findOne('srv-build')).resolves.toMatchObject({
        java_version: 21,
        server_build: '132',
        server_build_channel: 'STABLE',
      });
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
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith(server.id);
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
      expect(mockGatewayIpcService.publishRoute).toHaveBeenCalledWith(server.id);
    });
  });
});
