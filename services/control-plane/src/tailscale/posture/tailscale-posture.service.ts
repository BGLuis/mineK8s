import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { AppConfigService } from '@config/app-config.service';

import {
  FindingSeverity,
  PolicyTestOutcome,
  PostureAuditReport,
  PostureFinding,
  SecurityPostureStatus,
} from './posture-audit.dto';

export interface RawTailscaleAclRule {
  action?: string;
  src?: string[];
  dst?: string[];
  ip?: string[];
}

export interface RawTailscalePolicyTest {
  src: string;
  accept?: string[];
  deny?: string[];
}

export interface RawTailscalePolicy {
  tagOwners?: Record<string, string[]>;
  acls?: RawTailscaleAclRule[];
  grants?: Array<{ src?: string[]; dst?: string[]; ip?: string[] }>;
  tests?: RawTailscalePolicyTest[];
}

@Injectable()
export class TailscalePostureService implements OnModuleInit {
  private readonly logger = new Logger(TailscalePostureService.name);
  private latestReport: PostureAuditReport | null = null;

  constructor(private readonly configService: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.auditBootPosture();
  }

  /**
   * Executa a auditoria não destrutiva no boot do Control Plane (RF-TS-13).
   * Sem sobrescrever a política na nuvem em nenhuma hipótese.
   */
  async auditBootPosture(): Promise<PostureAuditReport> {
    this.logger.log('Iniciando auditoria de postura de segurança da Tailnet (Zero-Trust RF-TS-13)...');

    const tailscaleConfig = this.configService.tailscale;
    let policy: RawTailscalePolicy;
    let source: 'cloud_api' | 'local_file' | 'memory' = 'local_file';
    let isLiveChecked = false;

    if (tailscaleConfig.apiKey && tailscaleConfig.tailnetName) {
      try {
        policy = await this.fetchCloudAcl(tailscaleConfig.tailnetName, tailscaleConfig.apiKey);
        source = 'cloud_api';
        isLiveChecked = true;
        this.logger.log(`ACL ativa obtida da Tailscale Cloud API para a tailnet: ${tailscaleConfig.tailnetName}`);
      } catch (err: any) {
        this.logger.warn(
          `Falha ao consultar Tailscale Cloud API (${err?.message || err}). Recorrendo ao arquivo canônico local.`,
        );
        policy = this.loadLocalCanonicalPolicy();
      }
    } else {
      this.logger.log('Tailscale API Key não configurada. Avaliando política a partir do arquivo canônico local.');
      policy = this.loadLocalCanonicalPolicy();
    }

    const report = this.evaluatePolicy(policy, source, isLiveChecked);
    this.latestReport = report;

    if (report.status === SecurityPostureStatus.VULNERABLE) {
      this.logger.error(
        `🚨 ALERTA DE SEGURANÇA: Postura da Tailnet está VULNERABLE! ${report.findings.length} inconformidade(s) detectada(s).`,
      );
      for (const finding of report.findings) {
        this.logger.warn(`- [${finding.severity}] ${finding.description}`);
      }
    } else {
      this.logger.log('✅ Postura de segurança da Tailnet: COMPLIANT (Regras Zero-Trust aplicadas).');
    }

    return report;
  }

  /**
   * Retorna o relatório da última auditoria executada ou executa uma nova.
   */
  async getLatestAuditReport(forceRefresh = false): Promise<PostureAuditReport> {
    if (!this.latestReport || forceRefresh) {
      return this.auditBootPosture();
    }
    return this.latestReport;
  }

  /**
   * Avalia as regras de política e testes declarativos (huJSON).
   */
  evaluatePolicy(
    policy: RawTailscalePolicy,
    source: 'cloud_api' | 'local_file' | 'memory' = 'memory',
    isLiveChecked = false,
  ): PostureAuditReport {
    const findings: PostureFinding[] = [];
    let isVulnerable = false;

    const rules = policy.acls || [];
    let wildcardPlayerFound = false;
    let unrestrictedAdminFound = false;
    let onlyGamePortExposed = true;

    // 1. Inspecionar regras de ACL (acls / grants)
    rules.forEach((rule, idx) => {
      const srcList = rule.src || [];
      const dstList = rule.dst || [];
      const action = (rule.action || 'accept').toLowerCase();

      if (action !== 'accept') return;

      // Detectar curinga universal amplo no src
      if (srcList.includes('*')) {
        for (const dst of dstList) {
          if (dst === '*:*' || dst === '*') {
            findings.push({
              severity: 'CRITICAL',
              ruleIndex: idx,
              description: 'Broad universal wildcard detected: src ["*"] has unrestricted permission to dst ["*:*"].',
              rawRule: rule,
            });
            isVulnerable = true;
          }
        }
      }

      // Regras que afetam jogadores (tag:mc-player ou tag:player-*)
      const hasPlayerTag = srcList.some(
        (src) => src === 'tag:mc-player' || src.startsWith('tag:player-') || src === '*',
      );

      if (hasPlayerTag) {
        for (const dst of dstList) {
          if (dst === '*:*' || dst === '*') {
            wildcardPlayerFound = true;
            isVulnerable = true;
            onlyGamePortExposed = false;
            findings.push({
              severity: 'CRITICAL',
              ruleIndex: idx,
              description: `CRITICAL VULNERABILITY: Players (${srcList.join(', ')}) have unrestricted access (*:*) to the network.`,
              rawRule: rule,
            });
          } else {
            // Verificar porta destino
            const parts = dst.split(':');
            const port = parts[parts.length - 1];

            if (port === '*') {
              wildcardPlayerFound = true;
              isVulnerable = true;
              onlyGamePortExposed = false;
              findings.push({
                severity: 'CRITICAL',
                ruleIndex: idx,
                description: `VULNERABILIDADE: Jogadores possuem acesso a todas as portas do host (${dst}).`,
                rawRule: rule,
              });
            } else if (port !== '25565') {
              isVulnerable = true;
              onlyGamePortExposed = false;
              findings.push({
                severity: 'HIGH',
                ruleIndex: idx,
                description: `Zero-Trust vulnerability (RF-TS-01): Players are allowed access to non-Minecraft port (${port}) on destination ${dst}.`,
                rawRule: rule,
              });
            }
          }
        }
      }

      // Verificar autogroup:admin
      if (srcList.includes('autogroup:admin')) {
        unrestrictedAdminFound = true;
      }
    });

    // 2. Executar e validar a suíte de testes declarativos (tests clause, RF-TS-12)
    const testOutcomes = this.evaluatePolicyTests(rules, policy.tests || []);
    const failedTests = testOutcomes.filter((t) => !t.passed);

    if (failedTests.length > 0) {
      isVulnerable = true;
      for (const failed of failedTests) {
        findings.push({
          severity: 'HIGH',
          description: `ACL test assertion failed (RF-TS-12): ${failed.src} -> ${failed.target} (expected ${failed.expected}). Detail: ${failed.detail}`,
        });
      }
    }

    const status = isVulnerable ? SecurityPostureStatus.VULNERABLE : SecurityPostureStatus.COMPLIANT;

    return {
      status,
      timestamp: new Date().toISOString(),
      isTailnetLiveChecked: isLiveChecked,
      policySource: source,
      findings,
      testedRulesSummary: {
        totalRules: rules.length,
        wildcardPlayerFound,
        onlyGamePortExposed: onlyGamePortExposed && !wildcardPlayerFound,
        testsPassed: testOutcomes.length - failedTests.length,
        testsFailed: failedTests.length,
      },
      policyTestsResults: testOutcomes,
    };
  }

  /**
   * Simula a avaliação do tráfego para os testes declarativos do Tailscale huJSON.
   */
  evaluatePolicyTests(rules: RawTailscaleAclRule[], tests: RawTailscalePolicyTest[]): PolicyTestOutcome[] {
    const outcomes: PolicyTestOutcome[] = [];

    for (const test of tests) {
      const src = test.src;

      // Verificar destinos que devem ser aceitos (accept)
      for (const target of test.accept || []) {
        const permitted = this.simulateAclCheck(rules, src, target);
        outcomes.push({
          src,
          target,
          expected: 'accept',
          passed: permitted,
          detail: permitted
            ? 'Traffic allowed by the rule'
            : 'Expected the connection to be accepted but no matching rule was found',
        });
      }

      // Verificar destinos que devem ser negados (deny)
      for (const target of test.deny || []) {
        const permitted = this.simulateAclCheck(rules, src, target);
        outcomes.push({
          src,
          target,
          expected: 'deny',
          passed: !permitted,
          detail: !permitted
            ? 'Traffic blocked successfully'
            : 'SECURITY FAILURE: forbidden traffic was allowed by the ACL rules',
        });
      }
    }

    return outcomes;
  }

  /**
   * Simula verificação de uma regra de ACL individual (src -> dst).
   */
  private simulateAclCheck(rules: RawTailscaleAclRule[], src: string, target: string): boolean {
    const [targetHost, targetPort] = this.parseTarget(target);

    for (const rule of rules) {
      if ((rule.action || 'accept').toLowerCase() !== 'accept') continue;

      const ruleSrcs = rule.src || [];
      const srcMatches = ruleSrcs.includes('*') || ruleSrcs.includes(src);

      if (!srcMatches) continue;

      for (const dst of rule.dst || []) {
        const [ruleHost, rulePort] = this.parseTarget(dst);

        const hostMatches = ruleHost === '*' || ruleHost === targetHost || this.isSubnetMatch(ruleHost, targetHost);
        const portMatches = rulePort === '*' || rulePort === targetPort;

        if (hostMatches && portMatches) {
          return true;
        }
      }
    }

    return false;
  }

  private parseTarget(target: string): [string, string] {
    const lastColon = target.lastIndexOf(':');
    if (lastColon === -1) {
      return [target, '*'];
    }
    return [target.slice(0, lastColon), target.slice(lastColon + 1)];
  }

  private isSubnetMatch(ruleHost: string, targetHost: string): boolean {
    if (ruleHost.includes('/') && targetHost.includes('/')) {
      return ruleHost === targetHost;
    }
    return false;
  }

  /**
   * Carrega a política canônica local a partir dos caminhos padrão do repositório.
   */
  loadLocalCanonicalPolicy(): RawTailscalePolicy {
    const candidatePaths = [
      path.resolve(process.cwd(), 'k8s/tailscale/policy.hujson'),
      path.resolve(process.cwd(), 'tailscale/policy.hujson'),
      path.resolve(__dirname, '../../../../../k8s/tailscale/policy.hujson'),
      path.resolve(__dirname, '../../../../../tailscale/policy.hujson'),
    ];

    for (const filePath of candidatePaths) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          return this.parseHuJson(content);
        } catch (err: any) {
          this.logger.error(`Falha ao ler política em ${filePath}: ${err?.message}`);
        }
      }
    }

    this.logger.warn('Nenhum arquivo local policy.hujson encontrado. Utilizando política canônica estática interna.');
    return {
      tagOwners: {
        'tag:mc-gateway': ['autogroup:admin'],
        'tag:mc-player': ['tag:mc-gateway'],
      },
      acls: [
        { action: 'accept', src: ['autogroup:admin'], dst: ['*:*'] },
        { action: 'accept', src: ['tag:mc-player'], dst: ['tag:mc-gateway:25565'] },
      ],
      tests: [
        {
          src: 'tag:mc-player',
          accept: ['tag:mc-gateway:25565'],
          deny: ['tag:mc-gateway:22', 'tag:mc-gateway:3000', 'tag:mc-gateway:9090'],
        },
      ],
    };
  }

  /**
   * Consulta a API da Tailscale para obter a ACL atual.
   */
  private async fetchCloudAcl(tailnet: string, apiKey: string): Promise<RawTailscalePolicy> {
    const url = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/acl`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Tailscale API retornou HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data as RawTailscalePolicy;
  }

  /**
   * Sanitiza huJSON (JSON com comentários de linha // e vírgulas pendentes).
   */
  parseHuJson(raw: string): RawTailscalePolicy {
    // 1. Remover comentários de linha // e de bloco /* */
    let clean = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    clean = clean.replace(/\/\/.*$/gm, '');

    // 2. Remover vírgulas pendentes antes de fechar arrays ou objetos
    clean = clean.replace(/,\s*([}\]])/g, '$1');

    return JSON.parse(clean);
  }
}
