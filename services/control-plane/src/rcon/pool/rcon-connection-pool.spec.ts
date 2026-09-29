import { AppConfigService } from '../../config/app-config.service';
import { Server } from '../../database/entities/server.entity';
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
      state: 'READY',
      minecraft_settings: {
        rcon_port: 25575,
        rcon_password: 'test-secret-pool',
      },
    } as any;
  });

  afterEach(() => {
    pool.shutdownAll();
  });

  it('should create and store RconClient on getOrCreateConnection', async () => {
    const client = await pool.getOrCreateConnection(mockServer);
    expect(client).toBeDefined();

    const retrieved = pool.getConnection(mockServer.id);
    expect(retrieved).toBe(client);
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
