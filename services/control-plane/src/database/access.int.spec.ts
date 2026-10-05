import { DataSource } from 'typeorm';

import { AdminService } from '../admin/admin.service';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { PlayerSessionsService } from '../gateway-ipc/player-sessions.service';
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';
import { InvitesService } from '../tailscale/invites/invites.service';
import {
  Group,
  Invite,
  InviteGroup,
  InviteServer,
  Server,
  ServerGroup,
  TailscaleDevice,
  User,
  UserGroup,
  UserServerAccess,
} from './entities';
import {
  createIntegrationDataSource,
  describeWithDatabase,
} from './testing/integration-datasource';

/** Consultas e relações do TypeORM contra um Postgres real; o resto da suíte usa repositórios falsos. */
describeWithDatabase('Acesso e convites contra Postgres real', () => {
  let ds: DataSource;
  let admin: AdminService;
  let invites: InvitesService;
  let gatewayIpc: GatewayIpcService;
  let sessions: PlayerSessionsService;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_access');

    const repo = <T extends object>(entity: new () => T) => ds.getRepository(entity);
    const engine = new AccessDecisionEngineService();
    admin = new AdminService(
      repo(Group),
      repo(User),
      repo(Server),
      repo(UserGroup),
      repo(ServerGroup),
      repo(UserServerAccess),
      engine,
      {} as any,
      {} as any,
    );
    invites = new InvitesService(
      repo(Invite),
      repo(InviteGroup),
      repo(InviteServer),
      repo(User),
      repo(UserGroup),
      repo(UserServerAccess),
      repo(TailscaleDevice),
      {} as any,
      repo(Server),
    );
    sessions = new PlayerSessionsService();
    gatewayIpc = new GatewayIpcService(
      repo(Server),
      repo(User),
      repo(ServerGroup),
      repo(UserServerAccess),
      repo(UserGroup),
      undefined,
      undefined,
      sessions,
      { kubernetes: { namespace: 'minekubernetes' } } as any,
    );

    const server = (
      name: string,
      access_policy: Server['access_policy'],
      extra: Partial<Server> = {},
    ) =>
      repo(Server).save(
        repo(Server).create({
          name,
          subdomain: name.toLowerCase(),
          server_type: 'PAPER',
          game_version: '1.20.4',
          access_policy,
          ...extra,
        }),
      );
    const pub = await server('Publico', 'PUBLIC');
    const grp = await server('DoGrupo', 'GROUP');
    const outro = await server('OutroGrupo', 'GROUP');
    const indiv = await server('Individual', 'INDIVIDUAL');
    const manut = await server('Manutencao', 'GROUP', { is_maintenance: true });
    Object.assign(ids, {
      pub: pub.id,
      grp: grp.id,
      outro: outro.id,
      indiv: indiv.id,
      manut: manut.id,
    });

    const steve = await repo(User).save(
      repo(User).create({ minecraft_nick: 'Steve', real_name: 'Steve S', role: 'PLAYER' }),
    );
    const alex = await repo(User).save(
      repo(User).create({ minecraft_nick: 'Alex', role: 'ADMIN' }),
    );
    ids.steve = steve.id;
    ids.alex = alex.id;

    const amigos = await repo(Group).save(repo(Group).create({ name: 'amigos' }));
    const outros = await repo(Group).save(repo(Group).create({ name: 'outros' }));
    ids.amigos = amigos.id;
    await repo(UserGroup).save({ user_id: steve.id, group_id: amigos.id });
    await repo(ServerGroup).save([
      { server_id: grp.id, group_id: amigos.id },
      { server_id: outro.id, group_id: outros.id },
      { server_id: manut.id, group_id: amigos.id },
    ]);
    await repo(UserServerAccess).save({ user_id: steve.id, server_id: indiv.id });
    await repo(TailscaleDevice).save(
      repo(TailscaleDevice).create({
        user_id: steve.id,
        tailscale_tag: 'tag:mc-player-steve',
        device_name: 'PC',
        status: 'ACTIVE',
      }),
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('listUsers carrega dispositivos e grupos pelas relações reais, ordenado por nick', async () => {
    const users = await admin.listUsers();

    expect(users.map((u) => u.minecraftNick)).toEqual(['Alex', 'Steve']);
    const steve = users.find((u) => u.minecraftNick === 'Steve')!;
    expect(steve.groupIds).toEqual([ids.amigos]);
    expect(steve.devices).toEqual([
      expect.objectContaining({ deviceName: 'PC', status: 'ACTIVE' }),
    ]);
  });

  it('listAccessibleServers aplica as regras do gateway sobre dados reais', async () => {
    const steve = (await admin.listAccessibleServers(ids.steve)).map((s) => s.name).sort();
    expect(steve).toEqual(['DoGrupo', 'Individual', 'Publico']);

    const alex = await admin.listAccessibleServers(ids.alex);
    expect(alex).toHaveLength(5);
  });

  it('o convite guarda quem emitiu e a validação pública devolve os nomes dos servidores', async () => {
    const created = await invites.createInvite(
      { name: 'Turma', serverIds: [ids.pub, ids.grp], groupIds: [] } as any,
      'AdminSteve',
    );

    const validated = await invites.validateToken(created.token);

    expect(validated.createdBy).toBe('AdminSteve');
    expect([...(validated.serverNames ?? [])].sort()).toEqual(['DoGrupo', 'Publico']);
  });

  it('publishRoute envia grupos, usuários e a política efetiva, com manutenção como MAINTENANCE', async () => {
    const events: any[] = [];
    gatewayIpc.getRouteUpdatesStream().subscribe((event) => events.push(event));

    await gatewayIpc.publishRoute(ids.grp);
    await gatewayIpc.publishRoute(ids.manut);
    await gatewayIpc.publishRoute(ids.indiv);

    expect(events[0]).toMatchObject({
      access_policy: 'GROUP',
      allowed_group_ids: [ids.amigos],
      allowed_user_ids: [],
    });
    expect(events[1]).toMatchObject({ access_policy: 'MAINTENANCE' });
    expect(events[2]).toMatchObject({ access_policy: 'INDIVIDUAL', allowed_user_ids: [ids.steve] });
  });
});
