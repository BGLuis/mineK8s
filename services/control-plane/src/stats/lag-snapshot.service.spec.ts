import { ConflictException, NotFoundException } from '@nestjs/common';

import { LagSnapshotService } from './lag-snapshot.service';

const entityData = (nick: string, data: string) => `${nick} has the following entity data: ${data}`;

describe('LagSnapshotService', () => {
  let server: { id: string; state: string; server_type: string; subdomain: string };
  let online: string[];
  let commands: Record<string, string | Error>;
  let sent: string[];
  let service: LagSnapshotService;

  beforeEach(() => {
    server = { id: 'srv-1', state: 'READY', server_type: 'VANILLA', subdomain: 'alpha' };
    online = ['Farmer', 'Builder'];
    commands = {
      'data get entity Farmer Dimension': entityData('Farmer', '"minecraft:overworld"'),
      'data get entity Farmer Pos': entityData('Farmer', '[100.5d, 64.0d, -200.5d]'),
      'execute at Farmer if entity @e[type=!player,distance=..64]': 'Test passed, count: 800',
      'execute at Farmer if entity @e[type=item,distance=..64]': 'Test passed, count: 12',
      'data get entity Builder Dimension': entityData('Builder', '"minecraft:the_nether"'),
      'data get entity Builder Pos': entityData('Builder', '[0.0d, 70.0d, 0.0d]'),
      'execute at Builder if entity @e[type=!player,distance=..64]': 'Test passed, count: 20',
      'execute at Builder if entity @e[type=item,distance=..64]': 'Test failed',
      'execute in minecraft:overworld if entity @e[type=!player,distance=0..]':
        'Test passed, count: 950',
      'execute in minecraft:overworld if entity @e[type=item,distance=0..]':
        'Test passed, count: 40',
      'execute in minecraft:the_nether if entity @e[type=!player,distance=0..]':
        'Test passed, count: 60',
      'execute in minecraft:the_nether if entity @e[type=item,distance=0..]': 'Test failed',
      'execute in minecraft:the_end if entity @e[type=!player,distance=0..]': 'Test failed',
      'execute in minecraft:the_end if entity @e[type=item,distance=0..]': 'Test failed',
    };
    sent = [];

    const repo = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === server.id ? server : null,
      ),
    };
    const consoleDriver = {
      listPlayers: jest.fn(async () => online),
      sendCommand: jest.fn(async (_server: unknown, command: string) => {
        sent.push(command);
        const output = commands[command] ?? 'Unknown or incomplete command, see below for error';
        if (output instanceof Error) {
          throw output;
        }
        return output;
      }),
    };
    service = new LagSnapshotService(
      repo as unknown as ConstructorParameters<typeof LagSnapshotService>[0],
      consoleDriver as unknown as ConstructorParameters<typeof LagSnapshotService>[1],
    );
  });

  it('points at the player standing next to the entities, and not at the others', async () => {
    const snapshot = await service.take('srv-1');

    const warnings = snapshot.findings.filter((f) => f.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Farmer está perto de 800 entidades');
    expect(warnings[0].message).toContain('minecraft:overworld em 101 64 -200');
    expect(snapshot.players).toContainEqual({
      nick: 'Builder',
      dimension: 'minecraft:the_nether',
      position: { x: 0, y: 70, z: 0 },
      nearbyEntities: 20,
      nearbyItems: 0,
    });
  });

  it('counts each dimension on its own and lists who is in it', async () => {
    const snapshot = await service.take('srv-1');

    expect(snapshot.dimensions.map((d) => [d.id, d.entities, d.players])).toEqual([
      ['minecraft:overworld', 950, ['Farmer']],
      ['minecraft:the_nether', 60, ['Builder']],
      ['minecraft:the_end', 0, []],
    ]);
  });

  it('also looks at a modded dimension a player is in', async () => {
    commands['data get entity Builder Dimension'] = entityData('Builder', '"aether:the_aether"');
    commands['execute in aether:the_aether if entity @e[type=!player,distance=0..]'] =
      'Test passed, count: 7';

    const snapshot = await service.take('srv-1');

    expect(snapshot.dimensions.find((d) => d.id === 'aether:the_aether')).toMatchObject({
      entities: 7,
      players: ['Builder'],
    });
  });

  it('keeps going when a command fails, leaving only that field empty', async () => {
    commands['execute at Farmer if entity @e[type=!player,distance=..64]'] = new Error('timeout');

    const snapshot = await service.take('srv-1');

    expect(snapshot.players.find((p) => p.nick === 'Farmer')).toMatchObject({
      nearbyEntities: null,
      nearbyItems: 12,
    });
    expect(snapshot.dimensions).toHaveLength(3);
  });

  it('never puts a name that is not a Minecraft nickname into a command', async () => {
    online = ['Farmer', 'x @a run op Mallory'];

    await service.take('srv-1');

    expect(sent.some((command) => command.includes('Mallory'))).toBe(false);
  });

  it('flags a dimension that keeps many entities loaded with nobody there', async () => {
    commands['execute in minecraft:the_end if entity @e[type=!player,distance=0..]'] =
      'Test passed, count: 1200';

    const snapshot = await service.take('srv-1');

    expect(snapshot.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('minecraft:the_end tem 1200 entidades carregadas sem nenhum jogador'),
    );
  });

  it('lists entity types on Paper and names the one that dominates', async () => {
    server.server_type = 'PAPER';
    commands['paper entity list * minecraft:overworld'] = [
      'Total Ticking: 930, Total Non-Ticking: 20',
      '  700 (10) : minecraft:item',
      '  200 (10) : minecraft:cow',
      '  30 (0) : minecraft:zombie',
    ].join('\n');

    const snapshot = await service.take('srv-1');

    expect(snapshot.dimensions[0].topEntities[0]).toEqual({ type: 'minecraft:item', count: 710 });
    expect(snapshot.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('minecraft:item é a maioria das entidades em minecraft:overworld'),
    );
  });

  it('does not send Paper commands to a vanilla server', async () => {
    await service.take('srv-1');

    expect(sent.some((command) => command.startsWith('paper '))).toBe(false);
    expect(sent.some((command) => command.endsWith(' tps'))).toBe(false);
  });

  it('times each dimension on NeoForge, falling back to `forge tps`, and flags the slow one', async () => {
    server.server_type = 'NEOFORGE';
    commands['forge tps'] = [
      'Dim minecraft:overworld (minecraft:overworld): Mean tick time: 42.000 ms. Mean TPS: 20.000',
      'Dim minecraft:the_nether (minecraft:the_nether): Mean tick time: 1.000 ms. Mean TPS: 20.000',
    ].join('\n');

    const snapshot = await service.take('srv-1');

    expect(sent).toContain('neoforge tps');
    expect(snapshot.dimensions.map((d) => d.meanTickMs)).toEqual([42, 1, null]);
    expect(snapshot.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('minecraft:overworld gasta 42.0 ms por tick'),
    );
  });

  it('notes that without players nobody can be pointed at', async () => {
    online = [];

    const snapshot = await service.take('srv-1');

    expect(snapshot.players).toEqual([]);
    expect(snapshot.findings.at(-1)).toMatchObject({
      severity: 'info',
      message: expect.stringContaining('Nenhum jogador online'),
    });
  });

  it('refuses a server that is not running', async () => {
    server.state = 'SLEEPING';

    await expect(service.take('srv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 404 for an unknown server', async () => {
    await expect(service.take('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
