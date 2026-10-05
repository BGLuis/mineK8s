import { Server } from '../database/entities/server.entity';
import { RconClient } from '../rcon/client/rcon-client';
import { RconConnectionPool } from '../rcon/pool/rcon-connection-pool';
import { MinecraftRconConsoleDriver } from './minecraft-rcon-console.driver';

describe('MinecraftRconConsoleDriver (RF-MG-05, Guarda L-08)', () => {
  let driver: MinecraftRconConsoleDriver;
  let pool: jest.Mocked<RconConnectionPool>;
  let mockClient: jest.Mocked<RconClient>;
  let mockServer: Server;

  beforeEach(() => {
    mockClient = {
      sendCommand: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    } as any;

    pool = {
      getOrCreateConnection: jest.fn().mockResolvedValue(mockClient),
    } as any;

    driver = new MinecraftRconConsoleDriver(pool);

    mockServer = {
      id: 'srv-uuid-1',
      subdomain: 'survival',
      state: 'READY',
    } as any;
  });

  it('should send generic command via RconClient', async () => {
    mockClient.sendCommand.mockResolvedValue('Made Steve a server operator');

    const result = await driver.sendCommand(mockServer, 'op Steve');
    expect(pool.getOrCreateConnection).toHaveBeenCalledWith(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('op Steve', undefined);
    expect(result).toBe('Made Steve a server operator');
  });

  it('should parse player list correctly from list command', async () => {
    mockClient.sendCommand.mockResolvedValue(
      'There are 3 of a max of 20 players online: Steve, Alex, Notch',
    );

    const players = await driver.listPlayers(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('list', undefined);
    expect(players).toEqual(['Steve', 'Alex', 'Notch']);
  });

  it('should return empty list when no players are online', async () => {
    mockClient.sendCommand.mockResolvedValue('There are 0 of a max of 20 players online:');

    const players = await driver.listPlayers(mockServer);
    expect(players).toEqual([]);
  });

  it('should execute save-off, save-on and save-all flush with L-08 extended timeout', async () => {
    mockClient.sendCommand.mockResolvedValue('OK');

    await driver.saveOff(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('save-off', undefined);

    await driver.saveOn(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('save-on', undefined);

    // Guarda L-08: saveFlush deve usar timeout de 60.000 ms por padrão
    await driver.saveFlush(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('save-all flush', 60000);
  });

  it('should execute stop command via RconClient (RF-ARQ-08)', async () => {
    mockClient.sendCommand.mockResolvedValue('Stopping the server');
    const result = await driver.stop(mockServer);
    expect(mockClient.sendCommand).toHaveBeenCalledWith('stop', undefined);
    expect(result).toBe('Stopping the server');
  });

  it('should perform gracefulShutdown sending save-all flush and stop sequentially (RF-ARQ-08)', async () => {
    mockClient.sendCommand.mockResolvedValue('OK');
    await driver.gracefulShutdown(mockServer);

    expect(mockClient.sendCommand).toHaveBeenNthCalledWith(1, 'save-all flush', 15000);
    expect(mockClient.sendCommand).toHaveBeenNthCalledWith(2, 'stop', undefined);
  });
});
