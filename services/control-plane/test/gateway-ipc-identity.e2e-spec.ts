import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Group } from '../src/database/entities/group.entity';
import { Invite } from '../src/database/entities/invite.entity';
import { InviteGroup } from '../src/database/entities/invite-group.entity';
import { InviteServer } from '../src/database/entities/invite-server.entity';
import { Server } from '../src/database/entities/server.entity';
import { ServerGroup } from '../src/database/entities/server-group.entity';
import { TailscaleDevice } from '../src/database/entities/tailscale-device.entity';
import { User } from '../src/database/entities/user.entity';
import { UserGroup } from '../src/database/entities/user-group.entity';
import { UserServerAccess } from '../src/database/entities/user-server-access.entity';
import { GatewayIpcModule } from '../src/gateway-ipc/gateway-ipc.module';
import { GatewayIpcService } from '../src/gateway-ipc/gateway-ipc.service';
import { TailscaleLocalDriver } from '../src/tailscale/drivers/tailscale-local.driver';

/**
 * ResolvePlayerIdentity by client_ip needs the network identity provider, which only exists if
 * GatewayIpcModule wires TailscaleModule. Unit specs build the service by hand and cannot see a missing import,
 * so this compiles the real modules; only repositories and the Tailscale LocalAPI are faked.
 */
describe('GatewayIpcService identity resolution by client IP (real module wiring)', () => {
  const PLAYER_IP = '100.109.250.127';
  const admin = { id: 'u-admin', minecraft_nick: 'AdminSteve', role: 'ADMIN' } as User;

  async function compileGateway(whoIs: jest.Mock) {
    const emptyRepo = { find: async () => [], findOne: async () => null };
    const userRepo = {
      find: async () => [],
      findOne: async ({ where }: any) => (where.tailscale_user_id === '4242' ? admin : null),
    };
    let builder = Test.createTestingModule({ imports: [GatewayIpcModule] });
    for (const entity of [
      Server,
      ServerGroup,
      UserGroup,
      UserServerAccess,
      Invite,
      InviteGroup,
      InviteServer,
      TailscaleDevice,
      Group,
    ]) {
      builder = builder.overrideProvider(getRepositoryToken(entity)).useValue(emptyRepo);
    }
    builder = builder.overrideProvider(getRepositoryToken(User)).useValue(userRepo);
    builder = builder.overrideProvider(TailscaleLocalDriver).useValue({ queryWhoIs: whoIs });
    const moduleRef = await builder.compile();
    return moduleRef.get(GatewayIpcService);
  }

  it('identifies a player from the bare client IP the gateway sends when it has no tailscale_user_id', async () => {
    const whoIs = jest.fn(async () => ({ userId: '4242', nodeId: 'n1', tags: [] }));
    const service = await compileGateway(whoIs);

    const res = await service.resolvePlayerIdentity({
      tailscale_user_id: '',
      node_id: '',
      client_ip: PLAYER_IP,
    });

    expect(whoIs).toHaveBeenCalledWith(PLAYER_IP);
    expect(res).toMatchObject({ found: true, user_id: 'u-admin', role: 'ADMIN' });
  });

  it('answers found=false, not an error, when the tailnet does not know the IP', async () => {
    const service = await compileGateway(jest.fn(async () => null));

    const res = await service.resolvePlayerIdentity({
      tailscale_user_id: '',
      node_id: '',
      client_ip: PLAYER_IP,
    });

    expect(res.found).toBe(false);
  });
});
