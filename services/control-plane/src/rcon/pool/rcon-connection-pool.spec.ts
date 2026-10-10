import { AppConfigService } from '../../config/app-config.service';
import { Server } from '../../database/entities/server.entity';
import { RconClient } from '../client/rcon-client';
import { RconConnectionPool } from './rcon-connection-pool';

describe('RconConnectionPool (RF-RCON-03, PR-14)', () => {
  let pool: RconConnectionPool;
  let mockConfigService: jest.Mocked<AppConfigService>;
  let mockServer: Server;

  beforeEach(() => {
    mockConfigService = {
      kubernetes: {
        namespace: 'minekubernetes',
        useMockDriver: true,
      },
    } as any;

    pool = new RconConnectionPool(mockConfigService);

    mockServer = {
      id: 'srv-pool-1',
      subdomain: 'survival-test',
      resource_name: 'survival-test',
      state: 'READY',
      minecraft_settings: {
        rcon_port: 25575,
        rcon_password: 'test-secret-pool',
      },
    } as any;
  });

  afterEach(() => {
    pool.shutdownAll();
    jest.restoreAllMocks();
  });

  it('should create and store RconClient on getOrCreateConnection', async () => {
    const client = await pool.getOrCreateConnection(mockServer);
    expect(client).toBeDefined();

    const retrieved = pool.getConnection(mockServer.id);
    expect(retrieved).toBe(client);
  });

  it('conecta no Service pelo resource_name, que não muda quando o subdomínio muda', async () => {
    Object.assign(mockConfigService.kubernetes, { useMockDriver: false });
    jest.spyOn(RconClient.prototype, 'connect').mockResolvedValue(undefined);

    const client = await pool.getOrCreateConnection({
      ...mockServer,
      subdomain: 'endereco-novo',
    } as Server);

    expect(client['options'].host).toBe('mc-survival-test.minekubernetes.svc.cluster.local');
  });

  it('lê a senha RCON do banco quando o servidor chega sem minecraft_settings', async () => {
    Object.assign(mockConfigService.kubernetes, { useMockDriver: false });
    jest.spyOn(RconClient.prototype, 'connect').mockResolvedValue(undefined);
    const settingsRepo = {
      findOneBy: jest.fn(async () => ({ rcon_port: 25580, rcon_password: 'from-database' })),
    };
    pool = new RconConnectionPool(mockConfigService, settingsRepo as any);

    const client = await pool.getOrCreateConnection({
      ...mockServer,
      minecraft_settings: undefined,
    } as Server);

    expect(settingsRepo.findOneBy).toHaveBeenCalledWith({ server_id: 'srv-pool-1' });
    expect(client['options']).toMatchObject({ port: 25580, password: 'from-database' });
  });

  it('chamadas simultâneas compartilham a mesma conexão em vez de destruir uma à outra', async () => {
    const connect = jest.spyOn(RconClient.prototype, 'connect').mockResolvedValue(undefined);
    jest.spyOn(RconClient.prototype, 'isConnected').mockReturnValue(false);

    const [first, second] = await Promise.all([
      pool.getOrCreateConnection(mockServer),
      pool.getOrCreateConnection(mockServer),
    ]);

    expect(second).toBe(first);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('should remove and destroy connection on onServerStopped', async () => {
    const client = await pool.getOrCreateConnection(mockServer);
    const destroySpy = jest.spyOn(client, 'destroy');

    pool.onServerStopped(mockServer.id);

    expect(destroySpy).toHaveBeenCalled();
    expect(pool.getConnection(mockServer.id)).toBeUndefined();
  });

  it('should shutdown all active connections on module destroy', async () => {
    const client1 = await pool.getOrCreateConnection(mockServer);
    const server2: Server = {
      ...mockServer,
      id: 'srv-pool-2',
      subdomain: 'creative-test',
      resource_name: 'creative-test',
    };
    const client2 = await pool.getOrCreateConnection(server2);

    const destroySpy1 = jest.spyOn(client1, 'destroy');
    const destroySpy2 = jest.spyOn(client2, 'destroy');

    pool.onModuleDestroy();

    expect(destroySpy1).toHaveBeenCalled();
    expect(destroySpy2).toHaveBeenCalled();
    expect(pool.getConnection('srv-pool-1')).toBeUndefined();
    expect(pool.getConnection('srv-pool-2')).toBeUndefined();
  });
});
