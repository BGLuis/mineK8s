import { HealthBotReport, HealthBotServerOverview, PostureAuditReport } from '../../core/api';
import {
  POSTURE_VIEW,
  STAGE_LABEL,
  botRow,
  divergences,
  formatDuration,
  postureChecks,
  stageView,
} from './health-views';

function report(overrides: Partial<HealthBotReport> = {}): HealthBotReport {
  return {
    id: 'r1',
    serverId: 's1',
    subdomain: 'survival',
    timestamp: '2026-10-02T12:00:00.000Z',
    healthy: true,
    stage: 'spawn_verified',
    onlineMode: false,
    latencies: {
      tcpConnectMs: 10,
      handshakeLatencyMs: 20,
      loginLatencyMs: 30,
      spawnLatencyMs: 40,
      totalDurationMs: 212,
    },
    ...overrides,
  };
}

const overview = (latestReport?: HealthBotReport, state = 'READY'): HealthBotServerOverview => ({
  serverId: 's1',
  subdomain: 'survival',
  state,
  totalChecks: latestReport ? 1 : 0,
  successfulChecks: latestReport?.healthy ? 1 : 0,
  uptimePercentage: 100,
  avgTotalDurationMs: 0,
  latestReport,
});

describe('health bot stage labels', () => {
  it('translates every backend stage', () => {
    expect(STAGE_LABEL.spawn_verified).toBe('entrou no mundo');
    expect(STAGE_LABEL.encryption_challenge).toBe('servidor pediu autenticação (online-mode)');
    expect(STAGE_LABEL.login_success).toBe('login aceito');
    expect(STAGE_LABEL.failed).toBe('falhou');
  });

  it('keeps the raw stage next to the label for matching against logs', () => {
    expect(stageView(report()).code).toBe('spawn_verified');
  });

  it('marks a failed probe as danger and surfaces its error', () => {
    const view = stageView(report({ healthy: false, stage: 'failed', error: 'Socket closed' }));
    expect(view.tone).toBe('danger');
    expect(view.error).toBe('Socket closed');
  });

  it('marks a verified spawn as success without an error', () => {
    const view = stageView(report());
    expect(view.tone).toBe('success');
    expect(view.error).toBe('');
  });
});

describe('botRow', () => {
  it('shows latency and online-mode for a tested server', () => {
    const row = botRow(overview(report({ onlineMode: true })), 'Arena pública');
    expect(row.latency).toBe('212 ms');
    expect(row.mode).toBe('online-mode');
    expect(row.name).toBe('Arena pública');
  });

  it('has no latency for a failed probe', () => {
    const row = botRow(overview(report({ healthy: false, stage: 'failed' })), 'Pixelmon');
    expect(row.latency).toBe('—');
    expect(row.mode).toBe('offline');
  });

  it('explains a hibernating server instead of calling it a failure', () => {
    const row = botRow(overview(undefined, 'STOPPED'), 'Criativo');
    expect(row.stage.label).toBe('hibernado — não testado');
    expect(row.stage.tone).toBe('neutral');
    expect(row.latency).toBe('—');
    expect(row.mode).toBe('—');
  });

  it('prefers a fresh probe result over the overview', () => {
    const fresh = report({ healthy: false, stage: 'failed' });
    expect(botRow(overview(report()), 'x', fresh).stage.tone).toBe('danger');
  });
});

describe('posture', () => {
  const audit = (
    summary: Partial<PostureAuditReport['testedRulesSummary']>,
  ): PostureAuditReport => ({
    status: 'WARNING',
    timestamp: '2026-10-02T12:00:00.000Z',
    isTailnetLiveChecked: true,
    policySource: 'cloud_api',
    findings: [],
    testedRulesSummary: {
      totalRules: 4,
      wildcardPlayerFound: false,
      onlyGamePortExposed: true,
      testsPassed: 3,
      testsFailed: 0,
      ...summary,
    },
  });

  it('labels the four audit statuses', () => {
    expect(POSTURE_VIEW.COMPLIANT).toEqual({ label: 'CONFORME', tone: 'success' });
    expect(POSTURE_VIEW.WARNING).toEqual({ label: 'ATENÇÃO (WARNING)', tone: 'warning' });
    expect(POSTURE_VIEW.VULNERABLE).toEqual({ label: 'VULNERÁVEL', tone: 'danger' });
    expect(POSTURE_VIEW.ERROR.tone).toBe('danger');
  });

  it('passes every check on a clean policy', () => {
    expect(postureChecks(audit({})).every((check) => check.ok)).toBe(true);
  });

  it('fails the wildcard, port and test checks independently', () => {
    const checks = postureChecks(
      audit({ wildcardPlayerFound: true, onlyGamePortExposed: false, testsFailed: 2 }),
    );
    expect(checks.map((check) => check.ok)).toEqual([false, false, false]);
    expect(checks[2].text).toBe('2 testes de política falharam');
  });
});

describe('reconciler helpers', () => {
  it('formats duration in pt-BR', () => {
    expect(formatDuration(800)).toBe('800 ms');
    expect(formatDuration(1800)).toBe('1,8 s');
  });

  it('counts healed deployments and reconciled replicas as divergences', () => {
    expect(
      divergences({
        checked: 4,
        healedDeployments: ['a'],
        reconciledReplicas: ['b', 'c'],
        stateTransitions: [],
        durationMs: 1,
        timestamp: '',
      }),
    ).toEqual(['a', 'b', 'c']);
  });
});
