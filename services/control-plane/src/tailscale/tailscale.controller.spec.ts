import { SecurityPostureStatus } from './posture/posture-audit.dto';
import { TailscaleController } from './tailscale.controller';

describe('TailscaleController', () => {
  let controller: TailscaleController;
  let mockPostureService: any;

  beforeEach(() => {
    mockPostureService = {
      getLatestAuditReport: jest.fn(async (forceRefresh?: boolean) => ({
        status: SecurityPostureStatus.COMPLIANT,
        timestamp: '2026-09-29T18:00:00.000Z',
        isTailnetLiveChecked: false,
        policySource: 'local_file',
        findings: [],
        testedRulesSummary: {
          totalRules: 2,
          wildcardPlayerFound: false,
          onlyGamePortExposed: true,
          testsPassed: 7,
          testsFailed: 0,
        },
      })),
      evaluatePolicy: jest.fn((policy: any, source: string, live: boolean) => ({
        status: SecurityPostureStatus.VULNERABLE,
        timestamp: '2026-09-29T18:00:00.000Z',
        isTailnetLiveChecked: live,
        policySource: source,
        findings: [
          {
            severity: 'CRITICAL',
            description: 'Regra permissiva detectada em simulação',
          },
        ],
        testedRulesSummary: {
          totalRules: 1,
          wildcardPlayerFound: true,
          onlyGamePortExposed: false,
          testsPassed: 0,
          testsFailed: 1,
        },
      })),
    };

    controller = new TailscaleController(mockPostureService);
  });

  describe('GET /api/tailscale/posture-audit', () => {
    it('deve retornar o relatório de auditoria atual', async () => {
      const report = await controller.getPostureAudit();
      expect(report.status).toBe(SecurityPostureStatus.COMPLIANT);
      expect(mockPostureService.getLatestAuditReport).toHaveBeenCalledWith(false);
    });

    it('deve repassar flag refresh=true quando solicitado', async () => {
      await controller.getPostureAudit('true');
      expect(mockPostureService.getLatestAuditReport).toHaveBeenCalledWith(true);
    });
  });

  describe('POST /api/tailscale/posture-audit/evaluate', () => {
    it('deve avaliar simulação de política personalizada', async () => {
      const customPolicy = {
        acls: [{ action: 'accept', src: ['*'], dst: ['*:*'] }],
      };

      const result = await controller.evaluateCustomPolicy(customPolicy as any);
      expect(result.status).toBe(SecurityPostureStatus.VULNERABLE);
      expect(mockPostureService.evaluatePolicy).toHaveBeenCalledWith(customPolicy, 'memory', false);
    });
  });
});
