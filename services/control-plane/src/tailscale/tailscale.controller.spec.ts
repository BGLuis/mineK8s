import { SecurityPostureStatus } from './posture/posture-audit.dto';
import { TailscaleController } from './tailscale.controller';

describe('TailscaleController', () => {
  let controller: TailscaleController;
  let mockPostureService: any;
  let mockInvitesService: any;
  let mockDevicesService: any;

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

    mockInvitesService = {
      createInvite: jest.fn(async (dto) => ({
        id: 'inv-1',
        token: 'token-abc-12345678',
        name: dto.name,
        maxUses: dto.maxUses || 1,
        usedCount: 0,
        status: 'Active',
      })),
      listInvites: jest.fn(async () => [{ id: 'inv-1', token: 'token-abc', status: 'Active' }]),
      getInviteById: jest.fn(async (id) => ({
        id,
        token: 'token-abc',
        status: 'Active',
      })),
      revokeInvite: jest.fn(async (id) => ({
        id,
        token: 'token-abc',
        status: 'Revoked',
      })),
      validateToken: jest.fn(async (token) => ({
        id: 'inv-1',
        token,
        status: 'Active',
      })),
      claimInvite: jest.fn(async (dto) => ({
        userId: 'u-1',
        minecraftNick: dto.minecraftNick,
        authKey: 'tskey-auth-mock',
        deepLinkUrl: 'tailscale://login?key=tskey-auth-mock',
      })),
    };

    mockDevicesService = {
      listDevices: jest.fn(async () => [{ id: 'dev-1', status: 'ACTIVE' }]),
      getDeviceById: jest.fn(async (id: string) => ({ id, status: 'ACTIVE' })),
      revokeDevice: jest.fn(async (id: string) => ({
        message: 'Dispositivo revogado',
        deviceId: id,
      })),
      cleanInactiveDevices: jest.fn(async (days: number) => ({
        removedCount: 2,
        removedDeviceIds: ['dev-old-1', 'dev-old-2'],
      })),
    };

    controller = new TailscaleController(
      mockPostureService,
      mockInvitesService,
      mockDevicesService,
    );
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

  describe('Gestão de Convites (/api/tailscale/invites)', () => {
    it('deve delegar criação de convite para InvitesService', async () => {
      const dto = { name: 'Discord Amigos', maxUses: 3 };
      const res = await controller.createInvite(dto as any, {
        user: { minecraft_nick: 'AdminSteve' },
      });
      expect(res.name).toBe('Discord Amigos');
      expect(mockInvitesService.createInvite).toHaveBeenCalledWith(dto, 'AdminSteve');
    });

    it('deve listar convites', async () => {
      const res = await controller.listInvites();
      expect(res).toHaveLength(1);
      expect(mockInvitesService.listInvites).toHaveBeenCalled();
    });

    it('deve obter convite por ID', async () => {
      const res = await controller.getInviteById('inv-1');
      expect(res.id).toBe('inv-1');
      expect(mockInvitesService.getInviteById).toHaveBeenCalledWith('inv-1');
    });

    it('deve revogar convite', async () => {
      const res = await controller.revokeInvite('inv-1');
      expect(res.status).toBe('Revoked');
      expect(mockInvitesService.revokeInvite).toHaveBeenCalledWith('inv-1');
    });

    it('deve validar token público', async () => {
      const res = await controller.validateToken('token-abc');
      expect(res.status).toBe('Active');
      expect(mockInvitesService.validateToken).toHaveBeenCalledWith('token-abc');
    });

    it('deve resgatar convite público', async () => {
      const dto = {
        token: 'token-abc-12345678',
        realName: 'Lucas',
        minecraftNick: 'LucasCraft',
      };
      const res = await controller.claimInvite(dto);
      expect(res.minecraftNick).toBe('LucasCraft');
      expect(mockInvitesService.claimInvite).toHaveBeenCalledWith(dto);
    });
  });

  describe('Gestão de Dispositivos e Nível 2 de Revogação (/api/tailscale/devices)', () => {
    it('deve listar dispositivos registrados', async () => {
      const res = await controller.listDevices();
      expect(res).toHaveLength(1);
      expect(mockDevicesService.listDevices).toHaveBeenCalled();
    });

    it('deve obter dispositivo por ID', async () => {
      const res = await controller.getDeviceById('dev-1');
      expect(res.id).toBe('dev-1');
      expect(mockDevicesService.getDeviceById).toHaveBeenCalledWith('dev-1');
    });

    it('deve executar revogação Nível 2 (Ban de Rede Total)', async () => {
      const res = await controller.revokeDevice('dev-1');
      expect(res.deviceId).toBe('dev-1');
      expect(mockDevicesService.revokeDevice).toHaveBeenCalledWith('dev-1');
    });

    it('deve acionar DeviceGarbageCollector com threshold customizado', async () => {
      const res = await controller.runDeviceGarbageCollector('15');
      expect(res.removedCount).toBe(2);
      expect(mockDevicesService.cleanInactiveDevices).toHaveBeenCalledWith(15);
    });
  });
});
