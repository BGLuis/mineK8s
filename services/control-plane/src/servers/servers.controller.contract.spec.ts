import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

/**
 * Wires the real controller to the real service (only repositories and k8s are stubbed), so the
 * assertions are about what the API actually serializes, not about what a mock returns.
 */
describe('ServersController - response contract (#93)', () => {
  const RCON_SECRET = 'rcon-secret-that-must-not-leave-the-api';
  let controller: ServersController;
  let server: any;

  beforeEach(() => {
    server = {
      id: 'srv-1',
      name: 'Hub',
      subdomain: 'hub',
      game_type: 'minecraft',
      routing_model: 'sni-shared-port',
      server_type: 'PAPER',
      game_version: '1.21',
      allocated_memory_mb: 4096,
      allocated_port: null,
      state: 'READY',
      access_policy: 'INTERNET',
      is_maintenance: false,
      auto_wake: true,
      sleep_timeout_minutes: 15,
      created_at: new Date(),
      updated_at: new Date(),
    };
    server.minecraft_settings = {
      id: 'set-1',
      server_id: 'srv-1',
      motd: 'Hub',
      max_players: 20,
      difficulty: 'normal',
      gamemode: 'survival',
      hardcore: false,
      pvp: true,
      spawn_protection: 16,
      view_distance: 10,
      simulation_distance: 10,
      enable_rcon: true,
      rcon_port: 25575,
      rcon_password: RCON_SECRET,
      enforce_secure_chat: false,
      online_mode: true,
    };

    const serverRepo = {
      find: jest.fn(async () => [server]),
      findOne: jest.fn(async ({ where }: any) => (where.id === server.id ? server : null)),
      save: jest.fn(async (entity: any) => entity),
      create: jest.fn((dto: any) => ({ id: 'srv-new', ...dto })),
    };
    const settingsRepo = {
      create: jest.fn((dto: any) => ({ id: 'set-new', ...dto })),
      save: jest.fn(async (entity: any) => entity),
    };
    const auditRepo = { create: jest.fn((dto: any) => dto), save: jest.fn(async (e: any) => e) };
    const k8s = {
      listDeployments: jest.fn().mockResolvedValue([]),
      getServerDeployment: jest.fn().mockResolvedValue(null),
      provisionServer: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ServersService(
      serverRepo as any,
      settingsRepo as any,
      auditRepo as any,
      k8s as any,
      {} as any,
      {} as any,
    );
    controller = new ServersController(service, {} as any, {} as any);
  });

  const expectNoRconPassword = (body: unknown) => {
    const json = JSON.stringify(body);
    expect(json).not.toContain('rcon_password');
    expect(json).not.toContain(RCON_SECRET);
  };

  it('GET / lists access_policy and never the RCON password', async () => {
    const list = await controller.findAll();

    expect(list[0].access_policy).toBe('INTERNET');
    expectNoRconPassword(list);
  });

  it('GET :id returns access_policy and the settings without the RCON password, keeping online_mode', async () => {
    const detail = await controller.findOne('srv-1');

    expect(detail.access_policy).toBe('INTERNET');
    expect(detail.settings).toMatchObject({ online_mode: true, rcon_port: 25575, enable_rcon: true });
    expectNoRconPassword(detail);
  });

  it('PATCH :id (which answers with the detail) never leaks the RCON password', async () => {
    const updated = await controller.update('srv-1', { auto_wake: false });

    expect(updated.access_policy).toBe('INTERNET');
    expectNoRconPassword(updated);
  });

  it('POST / never echoes the RCON password, neither the generated nor the submitted one', async () => {
    const created = await controller.createDirect({
      name: 'New',
      subdomain: 'new',
      minecraft_settings: { rcon_password: RCON_SECRET },
    } as any);

    expectNoRconPassword(created);
  });

  it('POST/DELETE :id/publish never leak the RCON password', async () => {
    expectNoRconPassword(await controller.publish('srv-1'));
    expectNoRconPassword(await controller.unpublish('srv-1'));
  });

  it('exposes settings through an allow-list, so a new entity column is not leaked by default', async () => {
    server.minecraft_settings.internal_note = 'future column';

    const detail = await controller.findOne('srv-1');

    expect(detail.settings).not.toHaveProperty('internal_note');
  });
});
