import {
  FindingSeverity,
  HealthBotReport,
  HealthBotServerOverview,
  PostureAuditReport,
  ReconcilerStatus,
  ReconciliationSummary,
  SecurityPostureStatus,
} from '../../core/api/models';

export type ViewTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const TONE_TEXT: Record<ViewTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  info: 'text-status-info',
  neutral: 'text-text-muted',
};

export const TONE_BORDER: Record<ViewTone, string> = {
  success: 'border-status-success text-status-success',
  warning: 'border-status-warning text-status-warning',
  danger: 'border-status-danger text-status-danger',
  info: 'border-status-info text-status-info',
  neutral: 'border-status-neutral text-status-neutral',
};

/* ------------------------------------------------------------- health bot */

export const STAGE_LABEL: Record<HealthBotReport['stage'], string> = {
  spawn_verified: 'entrou no mundo',
  encryption_challenge: 'servidor pediu autenticação (online-mode)',
  login_success: 'login aceito',
  failed: 'falhou',
};

export interface StageView {
  label: string;
  /** Raw backend stage, kept next to the label so the admin can match it with the logs. */
  code: string;
  tone: ViewTone;
  /** Probe error text, only present for failures. */
  error: string;
}

export interface BotRow {
  serverId: string;
  name: string;
  stage: StageView;
  latency: string;
  latencyTitle: string;
  mode: string;
}

const STATE_WORD: Record<string, string> = {
  STOPPED: 'hibernado',
  READY: 'online',
  STARTING: 'iniciando',
  STOPPING: 'parando',
  PROVISIONING: 'provisionando',
  UPDATING: 'atualizando',
  CRASHED: 'travado',
  FAILED: 'falhou',
};

export function stageView(report: HealthBotReport): StageView {
  const failed = report.stage === 'failed' || !report.healthy;
  return {
    label: STAGE_LABEL[report.stage],
    code: report.stage,
    tone: failed ? 'danger' : 'success',
    error: failed ? (report.error ?? '') : '',
  };
}

/** Servers the bot has not tested yet are explained by their state instead of shown as failures. */
export function untestedView(state: string): StageView {
  const word = STATE_WORD[state] ?? state.toLowerCase();
  return { label: `${word} — não testado`, code: '', tone: 'neutral', error: '' };
}

export function latencyTitle(report: HealthBotReport): string {
  const { tcpConnectMs, handshakeLatencyMs, loginLatencyMs, spawnLatencyMs } = report.latencies;
  const parts = [
    `conexão ${tcpConnectMs} ms`,
    `handshake ${handshakeLatencyMs} ms`,
    `login ${loginLatencyMs} ms`,
  ];
  if (spawnLatencyMs !== undefined) {
    parts.push(`mundo ${spawnLatencyMs} ms`);
  }
  return parts.join(' · ');
}

export function botRow(
  overview: HealthBotServerOverview,
  name: string,
  latest: HealthBotReport | undefined = overview.latestReport,
): BotRow {
  if (!latest) {
    return {
      serverId: overview.serverId,
      name,
      stage: untestedView(overview.state),
      latency: '—',
      latencyTitle: '',
      mode: '—',
    };
  }
  return {
    serverId: overview.serverId,
    name,
    stage: stageView(latest),
    latency: latest.healthy ? `${latest.latencies.totalDurationMs} ms` : '—',
    latencyTitle: latencyTitle(latest),
    mode: latest.onlineMode ? 'online-mode' : 'offline',
  };
}

/* ---------------------------------------------------------------- posture */

export interface PostureView {
  label: string;
  tone: ViewTone;
}

export const POSTURE_VIEW: Record<SecurityPostureStatus, PostureView> = {
  COMPLIANT: { label: 'CONFORME', tone: 'success' },
  WARNING: { label: 'ATENÇÃO (WARNING)', tone: 'warning' },
  VULNERABLE: { label: 'VULNERÁVEL', tone: 'danger' },
  ERROR: { label: 'FALHA NA AUDITORIA', tone: 'danger' },
};

export const SEVERITY_VIEW: Record<FindingSeverity, PostureView> = {
  CRITICAL: { label: 'Crítica', tone: 'danger' },
  HIGH: { label: 'Alta', tone: 'danger' },
  MEDIUM: { label: 'Média', tone: 'warning' },
  LOW: { label: 'Baixa', tone: 'info' },
};

export const POLICY_SOURCE_LABEL: Record<PostureAuditReport['policySource'], string> = {
  cloud_api: 'API do Tailscale',
  local_file: 'arquivo local',
  memory: 'memória',
};

export interface PostureCheck {
  ok: boolean;
  text: string;
}

/** Plain-language checks derived from the audit summary, shown above the raw findings. */
export function postureChecks(report: PostureAuditReport): PostureCheck[] {
  const { wildcardPlayerFound, onlyGamePortExposed, testsPassed, testsFailed } =
    report.testedRulesSummary;
  const checks: PostureCheck[] = [
    wildcardPlayerFound
      ? { ok: false, text: 'Há regra curinga liberando tudo para jogadores' }
      : { ok: true, text: 'Nenhuma regra curinga para jogadores' },
    onlyGamePortExposed
      ? { ok: true, text: 'Jogadores só alcançam a porta do jogo' }
      : { ok: false, text: 'Jogadores alcançam portas além da do jogo' },
  ];
  if (testsFailed > 0) {
    checks.push({
      ok: false,
      text: `${testsFailed} ${testsFailed === 1 ? 'teste de política falhou' : 'testes de política falharam'}`,
    });
  } else if (testsPassed > 0) {
    checks.push({
      ok: true,
      text: `${testsPassed} ${testsPassed === 1 ? 'teste de política passou' : 'testes de política passaram'}`,
    });
  }
  return checks;
}

/* ------------------------------------------------------------- reconciler */

export function isIdle(
  status: ReconcilerStatus,
): status is Extract<ReconcilerStatus, { status: 'idle' }> {
  return 'status' in status && status.status === 'idle';
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Fixes applied by the last cycle: healed deployments plus reconciled replicas. */
export function divergences(summary: ReconciliationSummary): string[] {
  return [...summary.healedDeployments, ...summary.reconciledReplicas];
}
