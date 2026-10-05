import { TailscaleCompositeProvider } from './tailscale-composite.provider';
import { TailscaleLocalDriver } from '../drivers/tailscale-local.driver';
import { TailscaleCloudDriver } from '../drivers/tailscale-cloud.driver';
import { TailscalePostureService } from '../posture/tailscale-posture.service';
import { LocalSocketUnavailableException } from '../identity/tailscale-whois.types';
import { NetworkIdentity } from '../identity/network-identity-provider.interface';

describe('TailscaleCompositeProvider (RF-TS-05, RF-TS-14)', () => {
  let provider: TailscaleCompositeProvider;
  let localDriver: jest.Mocked<TailscaleLocalDriver>;
  let cloudDriver: jest.Mocked<TailscaleCloudDriver>;
  let postureService: jest.Mocked<TailscalePostureService>;

  const mockIdentity: NetworkIdentity = {
    userId: 'user-1',
    loginName: 'steve@mine.lan',
    displayName: 'Steve',
    nodeId: 'node-1',
    nodeName: 'steve-pc',
    nodeIp: '100.64.0.50',
    tags: ['tag:mc-player'],
    isOwner: false,
  };

  beforeEach(() => {
    localDriver = {
      queryWhoIs: jest.fn(),
      pingDaemon: jest.fn(),
      getSocketPath: jest.fn().mockReturnValue('/run/tailscale/tailscaled.sock'),
      setSocketPath: jest.fn(),
    } as any;

    cloudDriver = {
      findDeviceByIp: jest.fn(),
      getDevices: jest.fn(),
      generatePreAuthKey: jest.fn(),
      deleteDevice: jest.fn(),
      fetchAcl: jest.fn(),
    } as any;

    postureService = {
      auditBootPosture: jest.fn(),
    } as any;

    provider = new TailscaleCompositeProvider(localDriver, cloudDriver, postureService);
    provider.setCacheTtlMs(60_000);
  });

  it('deve resolver identidade via LocalDriver e utilizar cache nas consultas subsequentes (< 1ms)', async () => {
    localDriver.queryWhoIs.mockResolvedValueOnce(mockIdentity);

    // 1. Primeira consulta: aciona LocalDriver
    const firstResult = await provider.resolveIdentity('100.64.0.50');
    expect(firstResult).toEqual(mockIdentity);
    expect(localDriver.queryWhoIs).toHaveBeenCalledTimes(1);

    // 2. Segunda consulta: retorna do cache sem chamar novamente o driver
    const startCache = performance.now();
    const secondResult = await provider.resolveIdentity('100.64.0.50');
    const elapsedCache = performance.now() - startCache;

    expect(secondResult).toEqual(mockIdentity);
    expect(localDriver.queryWhoIs).toHaveBeenCalledTimes(1); // Não aumentou o número de chamadas
    expect(elapsedCache).toBeLessThan(1); // Latência de cache em memória < 1ms
  });

  it('consulta o IPv6 inteiro, sem a porta, na LocalAPI e no fallback (#130)', async () => {
    localDriver.queryWhoIs.mockRejectedValueOnce(
      new LocalSocketUnavailableException('Socket local não encontrado', 'ENOENT'),
    );
    cloudDriver.findDeviceByIp.mockResolvedValueOnce(mockIdentity);

    await provider.resolveIdentity('[fd7a:115c:a1e0::d338:4809]:51234');

    expect(localDriver.queryWhoIs).toHaveBeenCalledWith('fd7a:115c:a1e0::d338:4809');
    expect(cloudDriver.findDeviceByIp).toHaveBeenCalledWith('fd7a:115c:a1e0::d338:4809');
  });

  it('não pergunta a ninguém por um endereço sem IP legível (#130)', async () => {
    expect(await provider.resolveIdentity('fd7a')).toBeNull();
    expect(localDriver.queryWhoIs).not.toHaveBeenCalled();
  });

  it('deve acionar fallback transparente para CloudDriver quando LocalDriver lançar ENOENT (Critério de Aceite)', async () => {
    // Simula ENOENT (socket local não existe ou daemon fora do ar)
    localDriver.queryWhoIs.mockRejectedValueOnce(
      new LocalSocketUnavailableException('Socket local não encontrado', 'ENOENT'),
    );
    cloudDriver.findDeviceByIp.mockResolvedValueOnce(mockIdentity);

    const result = await provider.resolveIdentity('100.64.0.50');

    expect(result).toEqual(mockIdentity);
    expect(localDriver.queryWhoIs).toHaveBeenCalledWith('100.64.0.50');
    expect(cloudDriver.findDeviceByIp).toHaveBeenCalledWith('100.64.0.50');

    // Verifica que o resultado obtido via fallback foi gravado em cache
    const cachedResult = await provider.resolveIdentity('100.64.0.50');
    expect(cachedResult).toEqual(mockIdentity);
    expect(cloudDriver.findDeviceByIp).toHaveBeenCalledTimes(1);
  });

  it('deve propagar erro caso tanto o LocalDriver quanto o CloudDriver falhem', async () => {
    localDriver.queryWhoIs.mockRejectedValueOnce(
      new LocalSocketUnavailableException('Socket local não encontrado', 'ENOENT'),
    );
    cloudDriver.findDeviceByIp.mockRejectedValueOnce(
      new Error('Cloud API Timeout'),
    );

    await expect(provider.resolveIdentity('100.64.0.50')).rejects.toThrow(
      'Cloud API Timeout',
    );
  });

  it('deve revogar dispositivo no CloudDriver e invalidar cache do nó', async () => {
    localDriver.queryWhoIs.mockResolvedValueOnce(mockIdentity);
    cloudDriver.deleteDevice.mockResolvedValueOnce(true);

    // Popula o cache
    await provider.resolveIdentity('100.64.0.50');

    // Executa revogação
    const revoked = await provider.revokeDevice('node-1');
    expect(revoked).toBe(true);
    expect(cloudDriver.deleteDevice).toHaveBeenCalledWith('node-1');

    // Próxima consulta deve chamar o driver novamente pois o cache foi invalidado
    localDriver.queryWhoIs.mockResolvedValueOnce(mockIdentity);
    await provider.resolveIdentity('100.64.0.50');
    expect(localDriver.queryWhoIs).toHaveBeenCalledTimes(2);
  });

  it('deve auditar conformidade de ACL delegando ao TailscalePostureService', async () => {
    postureService.auditBootPosture.mockResolvedValueOnce({
      status: 'COMPLIANT',
      findings: [],
      timestamp: new Date().toISOString(),
    } as any);

    const report = await provider.auditAclCompliance();
    expect(report.compliant).toBe(true);
    expect(report.issues).toHaveLength(0);
  });
});
