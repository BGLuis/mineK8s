import { CloudflareDnsDriver } from './cloudflare-dns.driver';

describe('CloudflareDnsDriver (RF-TS-16, RF-CF-06, PR-13)', () => {
  let driver: CloudflareDnsDriver;
  const mockToken = 'mock-cf-token-12345';
  const mockZone = 'zone-abc-xyz';
  const mockRootDomain = 'minek8s.net';
  const mockBaseUrl = 'https://api.cloudflare.com/client/v4';

  let originalFetch: any;

  beforeEach(() => {
    driver = new CloudflareDnsDriver();
    driver.setConfig(mockToken, mockZone, mockRootDomain, mockBaseUrl);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('deve lançar erro se apiToken ou zoneId não estiverem configurados', async () => {
    const unconfiguredDriver = new CloudflareDnsDriver();
    unconfiguredDriver.setConfig('', '');
    await expect(unconfiguredDriver.listRecords()).rejects.toThrow(
      /CloudflareDnsDriver is not configured/,
    );
  });

  it('deve listar registros DNS com filtros de query string', async () => {
    const mockRecords = [
      {
        id: 'rec-1',
        type: 'A',
        name: '*.minek8s.net',
        content: '203.0.113.10',
        ttl: 1,
        proxied: false,
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        errors: [],
        messages: [],
        result: mockRecords,
      }),
    });

    const result = await driver.listRecords({ type: 'A', name: '*.minek8s.net' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(calledUrl).toContain(`/zones/${mockZone}/dns_records?type=A&name=*.minek8s.net`);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rec-1');
    expect(result[0].name).toBe('*.minek8s.net');
  });

  it('deve criar um novo registro DNS na Cloudflare', async () => {
    const mockCreated = {
      id: 'rec-new',
      type: 'A',
      name: '*.minek8s.net',
      content: '203.0.113.10',
      ttl: 1,
      proxied: false,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        errors: [],
        messages: [],
        result: mockCreated,
      }),
    });

    const result = await driver.createRecord({
      type: 'A',
      name: '*.minek8s.net',
      content: '203.0.113.10',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/zones/${mockZone}/dns_records`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result.id).toBe('rec-new');
  });

  it('deve atualizar um registro DNS existente', async () => {
    const mockUpdated = {
      id: 'rec-1',
      type: 'A',
      name: '*.minek8s.net',
      content: '203.0.113.99',
      ttl: 1,
      proxied: false,
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        errors: [],
        messages: [],
        result: mockUpdated,
      }),
    });

    const result = await driver.updateRecord('rec-1', {
      type: 'A',
      name: '*.minek8s.net',
      content: '203.0.113.99',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/zones/${mockZone}/dns_records/rec-1`,
      expect.objectContaining({
        method: 'PUT',
      }),
    );
    expect(result.content).toBe('203.0.113.99');
  });

  it('deve excluir um registro DNS pelo ID', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        errors: [],
        messages: [],
        result: { id: 'rec-del' },
      }),
    });

    const ok = await driver.deleteRecord('rec-del');
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/zones/${mockZone}/dns_records/rec-del`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deve excluir registros por nome e tipo (deleteRecordByNameAndType)', async () => {
    // 1ª chamada: lista registros
    // 2ª chamada: delete do primeiro
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{ id: 'rec-srv-1', type: 'SRV', name: '_minecraft._tcp.srv1.minek8s.net' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { id: 'rec-srv-1' },
        }),
      });

    const deleted = await driver.deleteRecordByNameAndType(
      '_minecraft._tcp.srv1.minek8s.net',
      'SRV',
    );
    expect(deleted).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('deve executar upsertWildcardA criando o registro se ele não existir (RF-TS-16)', async () => {
    // 1ª chamada: lista -> vazio
    // 2ª chamada: post -> cria
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            id: 'rec-wildcard-1',
            type: 'A',
            name: '*.minek8s.net',
            content: '198.51.100.5',
            ttl: 1,
          },
        }),
      });

    const res = await driver.upsertWildcardA('minek8s.net', '198.51.100.5');
    expect(res.id).toBe('rec-wildcard-1');
    expect(res.content).toBe('198.51.100.5');
  });

  it('deve executar upsertWildcardA atualizando o registro se já existir com IP diferente (RF-TS-16)', async () => {
    // 1ª chamada: lista -> retorna existente com IP antigo
    // 2ª chamada: put -> atualiza
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              id: 'rec-wildcard-1',
              type: 'A',
              name: '*.minek8s.net',
              content: '198.51.100.1',
              ttl: 1,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            id: 'rec-wildcard-1',
            type: 'A',
            name: '*.minek8s.net',
            content: '198.51.100.2',
            ttl: 1,
          },
        }),
      });

    const res = await driver.upsertWildcardA('minek8s.net', '198.51.100.2');
    expect(res.content).toBe('198.51.100.2');
  });

  it('deve executar upsertSrvRecord criando registro SRV formatado (RF-CF-05, RF-CF-07)', async () => {
    // 1ª chamada: lista -> vazio
    // 2ª chamada: post -> cria
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            id: 'rec-srv-1',
            type: 'SRV',
            name: '_minecraft._tcp.survival.minek8s.net',
            data: {
              service: '_minecraft',
              proto: '_tcp',
              name: 'survival.minek8s.net',
              priority: 0,
              weight: 5,
              port: 25565,
              target: 'survival.minek8s.net',
            },
          },
        }),
      });

    const res = await driver.upsertSrvRecord(
      'survival.minek8s.net',
      'survival.minek8s.net',
      25565,
      0,
      5,
    );

    expect(res.id).toBe('rec-srv-1');
    const createCallBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(createCallBody.type).toBe('SRV');
    expect(createCallBody.name).toBe('_minecraft._tcp.survival.minek8s.net');
    expect(createCallBody.data.port).toBe(25565);
    expect(createCallBody.data.target).toBe('survival.minek8s.net');
  });

  it('deve tratar rate limit (HTTP 429) com retry transparente', async () => {
    jest.useFakeTimers();

    const fetchPromise = Promise.resolve();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        headers: { get: () => '1' },
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          result: [],
        }),
      });

    const listPromise = driver.listRecords();

    // Avança timers para o delay do retry
    await jest.advanceTimersByTimeAsync(1500);

    const result = await listPromise;
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);

    jest.useRealTimers();
  });

  it('deve lançar erro detalhado quando a API Cloudflare retornar erro', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        success: false,
        errors: [{ code: 1004, message: 'DNS Validation Error' }],
        messages: [],
      }),
    });

    await expect(driver.listRecords()).rejects.toThrow(
      /Cloudflare API retornou erro.*\[1004\] DNS Validation Error/,
    );
  });

  it('lê token, zona e domínio raiz a cada requisição, sem reiniciar o pod', async () => {
    const cloudflare: { apiToken?: string; zoneId?: string; rootDomain: string } = {
      rootDomain: 'minek8s.net',
    };
    const live = new CloudflareDnsDriver({ cloudflare } as any);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, errors: [], messages: [], result: [] }),
    });

    await expect(live.listRecords()).rejects.toThrow(/not configured/);

    cloudflare.apiToken = 'cf-token-FAKE-0000';
    cloudflare.zoneId = 'zone-fake-1';
    cloudflare.rootDomain = 'mine.example';
    await live.listRecords();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/zones/zone-fake-1/dns_records');
    expect(init.headers.Authorization).toBe('Bearer cf-token-FAKE-0000');
    expect(live.getRootDomain()).toBe('mine.example');
  });
});
