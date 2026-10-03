import { ServersStateGateway } from './servers-state.gateway';

describe('ServersStateGateway (/ws/servers)', () => {
  const admin = { id: 'u1', role: 'ADMIN' };
  const player = { id: 'u2', role: 'PLAYER' };
  let gateway: ServersStateGateway;
  let authService: any;
  let jwtService: any;

  const socket = (auth: object = {}): any => ({
    handshake: { auth, headers: {}, query: {} },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeEach(() => {
    authService = {
      validateUserById: jest.fn(async (id: string) => (id === admin.id ? admin : id === player.id ? player : null)),
      validateTailscaleUser: jest.fn(async () => null),
    };
    jwtService = {
      verify: jest.fn((token: string) =>
        token === 'admin-jwt' ? { sub: admin.id } : token === 'player-jwt' ? { sub: player.id } : null,
      ),
    };
    gateway = new ServersStateGateway(authService, jwtService);
  });

  it('mantém conectado um administrador autenticado', async () => {
    const client = socket({ token: 'admin-jwt' });

    await gateway.handleConnection(client);

    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it.each([
    ['sem credenciais', {}],
    ['com token inválido', { token: 'lixo' }],
    ['de um jogador que não é admin', { token: 'player-jwt' }],
  ])('desconecta o cliente %s', async (_label, auth) => {
    const client = socket(auth);

    await gateway.handleConnection(client);

    expect(client.emit).toHaveBeenCalledWith('unauthorized', expect.any(Object));
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('transmite serverState para todos os clientes do namespace', () => {
    gateway.server = { emit: jest.fn() };

    gateway.emitServerState({ id: 'srv-1', status: 'READY', is_maintenance: false });

    expect(gateway.server.emit).toHaveBeenCalledWith('serverState', {
      id: 'srv-1',
      status: 'READY',
      is_maintenance: false,
    });
  });
});
