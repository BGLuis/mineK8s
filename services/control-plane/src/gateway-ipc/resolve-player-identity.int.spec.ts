import { DataSource } from 'typeorm';

import { Group, Server, ServerGroup, TailscaleDevice, User, UserGroup, UserServerAccess } from '@database/entities';
import { createIntegrationDataSource, describeWithDatabase } from '@database/testing/integration-datasource';
import { NetworkIdentityProvider } from '../tailscale/identity/network-identity-provider.interface';
import { GatewayIpcService } from './gateway-ipc.service';

/** A busca por nó atravessa a relação users → tailscale_devices; só o SQL real mostra se a coluna existe. */
describeWithDatabase('resolvePlayerIdentity contra Postgres real', () => {
  let ds: DataSource;
  let identityProvider: jest.Mocked<NetworkIdentityProvider>;
  let service: GatewayIpcService;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ds = await createIntegrationDataSource('int_resolve_identity');
    const repo = <T extends object>(entity: new () => T) => ds.getRepository(entity);

    identityProvider = { resolveIdentity: jest.fn() } as any;
    service = new GatewayIpcService(
      repo(Server), repo(User), repo(ServerGroup), repo(UserServerAccess), repo(UserGroup), identityProvider,
    );

    const steve = await repo(User).save(repo(User).create({ minecraft_nick: 'Steve', tailscale_user_id: '1001' }));
    const alex = await repo(User).save(repo(User).create({ minecraft_nick: 'Alex', role: 'ADMIN' }));
    const amigos = await repo(Group).save(repo(Group).create({ name: 'amigos' }));
    await repo(UserGroup).save({ user_id: alex.id, group_id: amigos.id });
    await repo(TailscaleDevice).save(
      repo(TailscaleDevice).create({ user_id: alex.id, node_id: 'nAlexPC', tailscale_tag: 'tag:mc-player-alex', status: 'ACTIVE' }),
    );
    Object.assign(ids, { steve: steve.id, alex: alex.id, amigos: amigos.id });
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('resolve pelo tailscale_user_id', async () => {
    const resp = await service.resolvePlayerIdentity({ tailscale_user_id: '1001', node_id: '', client_ip: '' });

    expect(resp).toMatchObject({ found: true, user_id: ids.steve, minecraft_nick: 'Steve' });
  });

  it('resolve pelo node_id do dispositivo quando o usuário do Tailscale não está vinculado', async () => {
    const resp = await service.resolvePlayerIdentity({ tailscale_user_id: '9999', node_id: 'nAlexPC', client_ip: '' });

    expect(resp).toMatchObject({ found: true, user_id: ids.alex, role: 'ADMIN', group_ids: [ids.amigos] });
  });

  it('resolve pelo node_id devolvido pelo WhoIs do IP', async () => {
    identityProvider.resolveIdentity.mockResolvedValueOnce({ nodeId: 'nAlexPC' } as any);

    const resp = await service.resolvePlayerIdentity({ tailscale_user_id: '', node_id: '', client_ip: '100.64.0.7' });

    expect(identityProvider.resolveIdentity).toHaveBeenCalledWith('100.64.0.7');
    expect(resp).toMatchObject({ found: true, user_id: ids.alex });
  });

  it('nó desconhecido não resolve ninguém', async () => {
    const resp = await service.resolvePlayerIdentity({ tailscale_user_id: '', node_id: 'nOutro', client_ip: '' });

    expect(resp.found).toBe(false);
  });
});
