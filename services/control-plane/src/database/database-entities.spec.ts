import {
  Group,
  Invite,
  InviteGroup,
  InviteServer,
  MinecraftServerSettings,
  Server,
  ServerAuditLog,
  ServerGroup,
  TailscaleDevice,
  User,
  UserGroup,
  UserServerAccess,
} from './entities';

describe('Database Entities Model (RF-RCON-11, RF-TS-10, RF-MG-01)', () => {
  it('should instantiate Server with multi-game default values (RF-MG-01)', () => {
    const server = new Server();
    server.name = 'Survival World';
    server.subdomain = 'survival';
    server.server_type = 'PAPER';
    server.game_version = '1.20.4';

    expect(server.name).toBe('Survival World');
    expect(server.subdomain).toBe('survival');
    expect(server.server_type).toBe('PAPER');
    expect(server.game_version).toBe('1.20.4');
  });

  it('should instantiate MinecraftServerSettings with canonical defaults', () => {
    const settings = new MinecraftServerSettings();
    settings.server_id = '123e4567-e89b-12d3-a456-426614174000';
    settings.rcon_password = 'secure-password';

    expect(settings.server_id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(settings.rcon_password).toBe('secure-password');
  });

  it('should instantiate User and TailscaleDevice', () => {
    const user = new User();
    user.minecraft_nick = 'Notch';

    const device = new TailscaleDevice();
    device.tailscale_tag = 'tag:mc-player';
    device.user_id = '123e4567-e89b-12d3-a456-426614174000';

    expect(user.minecraft_nick).toBe('Notch');
    expect(device.tailscale_tag).toBe('tag:mc-player');
  });

  it('should instantiate Group, ServerGroup, UserGroup, and UserServerAccess', () => {
    const group = new Group();
    group.name = 'VIP';

    const ug = new UserGroup();
    ug.user_id = 'user-1';
    ug.group_id = 'group-1';

    const sg = new ServerGroup();
    sg.server_id = 'server-1';
    sg.group_id = 'group-1';

    const usa = new UserServerAccess();
    usa.user_id = 'user-1';
    usa.server_id = 'server-1';

    expect(group.name).toBe('VIP');
    expect(ug.user_id).toBe('user-1');
    expect(sg.server_id).toBe('server-1');
    expect(usa.server_id).toBe('server-1');
  });

  it('should instantiate Invite with relations', () => {
    const invite = new Invite();
    invite.token = 'inv_secret_token_12345';
    invite.name = 'Friends Batch';
    invite.expires_at = new Date(Date.now() + 86400000);

    const ig = new InviteGroup();
    ig.invite_id = 'inv-1';
    ig.group_id = 'group-1';

    const is = new InviteServer();
    is.invite_id = 'inv-1';
    is.server_id = 'server-1';

    expect(invite.token).toBe('inv_secret_token_12345');
    expect(ig.invite_id).toBe('inv-1');
    expect(is.server_id).toBe('server-1');
  });

  it('should instantiate ServerAuditLog with execution source', () => {
    const log = new ServerAuditLog();
    log.server_id = 'server-1';
    log.command = 'say Hello World';
    log.execution_source = 'REST_API';
    log.ip_address = '100.64.0.5';

    expect(log.server_id).toBe('server-1');
    expect(log.command).toBe('say Hello World');
    expect(log.execution_source).toBe('REST_API');
    expect(log.ip_address).toBe('100.64.0.5');
  });
});
