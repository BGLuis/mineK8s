import { TailscaleCloudDriver } from './tailscale-cloud.driver';

describe('TailscaleCloudDriver (RF-TS-05, RF-TS-14)', () => {
  let driver: TailscaleCloudDriver;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    driver = new TailscaleCloudDriver();
    driver.setConfig('tskey-test-token', 'tailnet-test.ts.net', 'https://mock.tailscale.local');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('deve listar dispositivos e encontrar nó por endereço IP', async () => {
    const mockDevices = [
      {
        id: 'dev-1',
        nodeId: 'node-stable-1',
        name: 'player-device',
        user: 'player@mine.lan',
        addresses: ['100.64.0.25', 'fd7a:115c:a1e0::25'],
        tags: ['tag:mc-player'],
      },
      {
        id: 'dev-2',
        nodeId: 'node-stable-2',
        name: 'gateway-node',
        user: 'admin@mine.lan',
        addresses: ['100.64.0.1'],
        tags: ['tag:mc-gateway'],
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ devices: mockDevices }),
    } as any);

    const identity = await driver.findDeviceByIp('100.64.0.25');
    expect(identity).toBeDefined();
    expect(identity?.nodeId).toBe('node-stable-1');
    expect(identity?.loginName).toBe('player@mine.lan');
    expect(identity?.tags).toContain('tag:mc-player');
    expect(identity?.isOwner).toBe(false);

    // Consulta para IP inexistente
    const notFound = await driver.findDeviceByIp('100.64.0.99');
    expect(notFound).toBeNull();
  });

  describe('fallback de identidade (#130)', () => {
    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          devices: [
            {
              id: '92960230385',
              nodeId: 'nd4Jzj81et11CNTRL',
              name: 'steve-pc',
              user: 'steve@mine.lan',
              addresses: ['100.68.72.9', 'fd7a:115c:a1e0::d338:4809'],
            },
          ],
        }),
      } as any);
    });

    it.each(['fd7a:115c:a1e0::d338:4809', '[fd7a:115c:a1e0::d338:4809]:25565', '100.68.72.9:51234', '::ffff:100.68.72.9'])(
      'encontra o dispositivo pelo endereço %s',
      async (address) => {
        const identity = await driver.findDeviceByIp(address);

        expect(identity?.nodeId).toBe('nd4Jzj81et11CNTRL');
      },
    );

    it('não põe o login name no userId, que é casado com o ID numérico de users.tailscale_user_id', async () => {
      const identity = await driver.findDeviceByIp('100.68.72.9');

      expect(identity?.userId).toBe('');
      expect(identity?.loginName).toBe('steve@mine.lan');
    });

    it('não consulta a API para um endereço sem IP legível', async () => {
      expect(await driver.findDeviceByIp('fd7a')).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  it('deve gerar chave pré-autenticada com tags e expiração', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        key: 'tskey-auth-preauth-123456',
        id: 'k12345',
        expires: '2026-10-01T00:00:00.000Z',
      }),
    } as any);

    const result = await driver.generatePreAuthKey(['tag:mc-player'], 3600);
    expect(result.key).toBe('tskey-auth-preauth-123456');
    expect(result.tags).toEqual(['tag:mc-player']);
    expect(result.expires).toBeInstanceOf(Date);
  });

  it('deve excluir dispositivo da Tailnet com sucesso', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as any);

    const success = await driver.deleteDevice('dev-to-delete');
    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://mock.tailscale.local/api/v2/device/dev-to-delete',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deve tratar rate limit HTTP 429 com retry e cabeçalho Retry-After', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '0' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ devices: [] }),
      });
    });

    const devices = await driver.getDevices();
    expect(devices).toEqual([]);
    expect(callCount).toBe(2);
  });
});
