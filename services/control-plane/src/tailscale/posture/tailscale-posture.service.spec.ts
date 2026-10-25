import { AppConfigService } from '@config/app-config.service';

import { SecurityPostureStatus } from './posture-audit.dto';
import { RawTailscalePolicy, TailscalePostureService } from './tailscale-posture.service';

describe('TailscalePostureService (RF-TS-01, RF-TS-12, RF-TS-13, RF-TS-17)', () => {
  let service: TailscalePostureService;
  let mockConfigService: Partial<AppConfigService>;

  beforeEach(() => {
    mockConfigService = {
      tailscale: {
        apiKey: undefined,
        tailnetName: undefined,
        socketPath: '/run/tailscale/tailscaled.sock',
        authEnabled: true,
        trustedProxyIps: [],
      } as any,
    };

    service = new TailscalePostureService(mockConfigService as AppConfigService);
  });

  describe('Auditoria de Política Canônica Oficial (RF-TS-01, RF-TS-12)', () => {
    it('deve validar que a política canônica oficial do repositório é COMPLIANT', () => {
      const canonicalPolicy = service.loadLocalCanonicalPolicy();
      const report = service.evaluatePolicy(canonicalPolicy, 'local_file', false);

      expect(report.status).toBe(SecurityPostureStatus.COMPLIANT);
      expect(report.findings).toHaveLength(0);
      expect(report.testedRulesSummary.onlyGamePortExposed).toBe(true);
      expect(report.testedRulesSummary.wildcardPlayerFound).toBe(false);
      expect(report.testedRulesSummary.testsFailed).toBe(0);
      expect(report.testedRulesSummary.testsPassed).toBeGreaterThan(0);
    });

    it('deve confirmar que os testes da policy passam (RF-TS-12, Critério de Aceite)', () => {
      const canonicalPolicy = service.loadLocalCanonicalPolicy();
      const tests = canonicalPolicy.tests || [];

      expect(tests.length).toBeGreaterThan(0);

      const outcomes = service.evaluatePolicyTests(canonicalPolicy.acls || [], tests);
      const allPassed = outcomes.every((o) => o.passed);

      expect(allPassed).toBe(true);

      // Asserções específicas de Zero-Trust
      const playerMcPort = outcomes.find(
        (o) =>
          o.src === 'tag:mc-player' &&
          o.target === 'tag:mc-gateway:25565' &&
          o.expected === 'accept',
      );
      expect(playerMcPort?.passed).toBe(true);

      const playerPanelPort = outcomes.find(
        (o) =>
          o.src === 'tag:mc-player' &&
          o.target === 'tag:mc-gateway:8080' &&
          o.expected === 'accept',
      );
      expect(playerPanelPort?.passed).toBe(true);

      const playerSshPort = outcomes.find(
        (o) =>
          o.src === 'tag:mc-player' && o.target === 'tag:mc-gateway:22' && o.expected === 'deny',
      );
      expect(playerSshPort?.passed).toBe(true);

      const playerApiPort = outcomes.find(
        (o) =>
          o.src === 'tag:mc-player' && o.target === 'tag:mc-gateway:3000' && o.expected === 'deny',
      );
      expect(playerApiPort?.passed).toBe(true);
    });
  });

  describe('Critério de Aceite: Regra curinga ampla marca VULNERABLE (RF-TS-13, RF-TS-17)', () => {
    it('deve marcar VULNERABLE se existir regra curinga ampla *: * para tag:mc-player', () => {
      const vulnerablePolicy: RawTailscalePolicy = {
        acls: [
          {
            action: 'accept',
            src: ['tag:mc-player'],
            dst: ['*:*'],
          },
        ],
        tests: [],
      };

      const report = service.evaluatePolicy(vulnerablePolicy);

      expect(report.status).toBe(SecurityPostureStatus.VULNERABLE);
      expect(report.testedRulesSummary.wildcardPlayerFound).toBe(true);
      expect(report.findings.some((f) => f.severity === 'CRITICAL')).toBe(true);
      expect(report.findings[0].description).toContain('CRITICAL VULNERABILITY');
    });

    it('deve marcar VULNERABLE se existir regra universal com src [*] e dst [*:*]', () => {
      const openPolicy: RawTailscalePolicy = {
        acls: [
          {
            action: 'accept',
            src: ['*'],
            dst: ['*:*'],
          },
        ],
        tests: [],
      };

      const report = service.evaluatePolicy(openPolicy);

      expect(report.status).toBe(SecurityPostureStatus.VULNERABLE);
      expect(report.findings.some((f) => f.description.includes('Broad universal wildcard'))).toBe(
        true,
      );
    });

    it('deve marcar VULNERABLE se tag:mc-player tiver acesso a porta administrativa (ex: 22 ou 3000)', () => {
      const leakyPolicy: RawTailscalePolicy = {
        acls: [
          {
            action: 'accept',
            src: ['tag:mc-player'],
            dst: ['tag:mc-gateway:25565', 'tag:mc-gateway:22'],
          },
        ],
        tests: [],
      };

      const report = service.evaluatePolicy(leakyPolicy);

      expect(report.status).toBe(SecurityPostureStatus.VULNERABLE);
      expect(report.findings.some((f) => f.description.includes('non-Minecraft port (22)'))).toBe(
        true,
      );
    });

    it('deve aceitar portas 25565 e 8080 para tag:mc-player sem apontar vulnerabilidades (#216)', () => {
      const compliantPolicy: RawTailscalePolicy = {
        acls: [
          {
            action: 'accept',
            src: ['tag:mc-player'],
            dst: ['tag:mc-gateway:25565', 'tag:mc-gateway:8080'],
          },
        ],
        tests: [],
      };

      const report = service.evaluatePolicy(compliantPolicy);

      expect(report.status).toBe(SecurityPostureStatus.COMPLIANT);
      expect(report.findings).toHaveLength(0);
      expect(report.testedRulesSummary.onlyGamePortExposed).toBe(true);
    });

    it('deve marcar HIGH para portas não autorizadas como 22, 3000 ou 9090 (#216)', () => {
      for (const unauthorizedPort of ['22', '3000', '9090']) {
        const policy: RawTailscalePolicy = {
          acls: [
            {
              action: 'accept',
              src: ['tag:mc-player'],
              dst: [`tag:mc-gateway:${unauthorizedPort}`],
            },
          ],
          tests: [],
        };

        const report = service.evaluatePolicy(policy);

        expect(report.status).toBe(SecurityPostureStatus.VULNERABLE);
        expect(report.testedRulesSummary.onlyGamePortExposed).toBe(false);
        const highFinding = report.findings.find(
          (f) => f.severity === 'HIGH' && f.description.includes(unauthorizedPort),
        );
        expect(highFinding).toBeDefined();
      }
    });

    it('deve marcar VULNERABLE se os testes declarativos da policy falharem', () => {
      const policyWithFailingTest: RawTailscalePolicy = {
        acls: [{ action: 'accept', src: ['tag:mc-player'], dst: ['tag:mc-gateway:25565'] }],
        tests: [
          {
            src: 'tag:mc-player',
            accept: ['tag:mc-gateway:8080'],
          },
        ],
      };

      const report = service.evaluatePolicy(policyWithFailingTest);

      expect(report.status).toBe(SecurityPostureStatus.VULNERABLE);
      expect(report.testedRulesSummary.testsFailed).toBe(1);
    });
  });

  describe('Auditoria Não-Destrutiva no Boot (RF-TS-13)', () => {
    it('deve executar auditoria no boot e reter o relatório em memória', async () => {
      const report = await service.auditBootPosture();

      expect(report).toBeDefined();
      expect(report.status).toBe(SecurityPostureStatus.COMPLIANT);
      expect(report.policySource).toBe('local_file');

      const cached = await service.getLatestAuditReport();
      expect(cached).toBe(report);
    });

    it('deve consultar a Cloud API quando as credenciais estiverem disponíveis e cair em fallback seguro se falhar', async () => {
      (mockConfigService as any).tailscale = {
        apiKey: 'tskey-api-test',
        tailnetName: 'test.tailnet',
        socketPath: '/run/tailscale/tailscaled.sock',
        authEnabled: true,
        trustedProxyIps: [],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          acls: [
            { action: 'accept', src: ['autogroup:admin'], dst: ['*:*'] },
            { action: 'accept', src: ['tag:mc-player'], dst: ['tag:mc-gateway:25565'] },
          ],
          tests: [
            {
              src: 'tag:mc-player',
              accept: ['tag:mc-gateway:25565'],
              deny: ['tag:mc-gateway:22'],
            },
          ],
        }),
      });
      global.fetch = mockFetch;

      const report = await service.auditBootPosture();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tailscale.com/api/v2/tailnet/test.tailnet/acl',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tskey-api-test',
          }),
        }),
      );
      expect(report.isTailnetLiveChecked).toBe(true);
      expect(report.status).toBe(SecurityPostureStatus.COMPLIANT);
    });

    it('não deve conter nenhum método de mutação destrutiva que sobrescreva a ACL na Cloud API (RF-TS-13)', () => {
      const serviceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const destructiveMethods = serviceMethods.filter(
        (m) =>
          m.toLowerCase().includes('writeacl') ||
          m.toLowerCase().includes('updateacl') ||
          m.toLowerCase().includes('overwrite'),
      );
      expect(destructiveMethods).toHaveLength(0);
    });
  });

  describe('Sanitização de huJSON', () => {
    it('deve processar comentários de linha e vírgulas finais sem erro de parsing', () => {
      const hujsonSample = `
        {
          // Comentário explicativo
          "acls": [
            {
              "action": "accept",
              "src": ["tag:mc-player"],
              "dst": ["tag:mc-gateway:25565"], // vírgula final
            },
          ],
        }
      `;

      const parsed = service.parseHuJson(hujsonSample);
      expect(parsed.acls).toHaveLength(1);
      expect(parsed.acls?.[0].dst).toEqual(['tag:mc-gateway:25565']);
    });
  });
});
