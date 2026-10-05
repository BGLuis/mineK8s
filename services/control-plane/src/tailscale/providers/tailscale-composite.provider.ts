import { Injectable, Logger } from '@nestjs/common';
import { TailscaleLocalDriver } from '../drivers/tailscale-local.driver';
import { TailscaleCloudDriver } from '../drivers/tailscale-cloud.driver';
import { TailscalePostureService } from '../posture/tailscale-posture.service';
import {
  AclComplianceReport,
  NetworkIdentity,
  NetworkIdentityProvider,
  PreAuthKeyResult,
} from '../identity/network-identity-provider.interface';
import { LocalSocketUnavailableException } from '../identity/tailscale-whois.types';
import { parseClientAddress } from '../identity/client-address';

interface CachedEntry {
  identity: NetworkIdentity | null;
  expiresAt: number;
}

@Injectable()
export class TailscaleCompositeProvider implements NetworkIdentityProvider {
  private readonly logger = new Logger(TailscaleCompositeProvider.name);
  private readonly cache = new Map<string, CachedEntry>();
  private cacheTtlMs: number = 120_000; // 120 segundos padronizados

  constructor(
    private readonly localDriver: TailscaleLocalDriver,
    private readonly cloudDriver: TailscaleCloudDriver,
    private readonly postureService?: TailscalePostureService,
  ) {}

  public setCacheTtlMs(ttl: number): void {
    this.cacheTtlMs = ttl;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resolução Zero-Trust de Identidade por IP (RF-GW-08, RF-TS-05, RF-TS-14).
   * 1. Consulta em cache em memória (< 1 ms).
   * 2. Consulta ultra-rápida via Unix Domain Socket local (< 5 ms).
   * 3. Fallback automático para Cloud API em caso de ENOENT / indisponibilidade do socket.
   */
  public async resolveIdentity(clientIp: string): Promise<NetworkIdentity | null> {
    const cleanIp = parseClientAddress(clientIp);
    if (!cleanIp) {
      this.logger.warn(`Endereço de cliente sem IP legível, identidade não resolvida: ${clientIp}`);
      return null;
    }

    // 1. Verificação de Cache
    const cached = this.cache.get(cleanIp);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.identity;
    }

    // 2. Tenta LocalDriver via Unix Socket
    try {
      const identity = await this.localDriver.queryWhoIs(cleanIp);
      this.cache.set(cleanIp, {
        identity,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return identity;
    } catch (err: any) {
      if (
        err instanceof LocalSocketUnavailableException ||
        err.code === 'ENOENT' ||
        err.name === 'LocalSocketUnavailableException'
      ) {
        this.logger.warn(
          `LocalAPI WhoIs indisponível no socket Unix (${err.message}). Acionando fallback para Tailscale Cloud API (RF-TS-14)...`,
        );

        // 3. Fallback gracioso para a API REST da Cloud
        try {
          const cloudIdentity = await this.cloudDriver.findDeviceByIp(cleanIp);
          this.cache.set(cleanIp, {
            identity: cloudIdentity,
            expiresAt: Date.now() + this.cacheTtlMs,
          });
          return cloudIdentity;
        } catch (cloudErr: any) {
          this.logger.error(
            `Falha também no fallback da Cloud API para o IP ${cleanIp}: ${cloudErr.message}`,
          );
          throw cloudErr;
        }
      }

      throw err;
    }
  }

  /**
   * Revoga e remove um dispositivo da rede (Nível 2 - RF-TS-07).
   */
  public async revokeDevice(deviceId: string): Promise<boolean> {
    const result = await this.cloudDriver.deleteDevice(deviceId);

    // Invalida cache de IPs associados
    for (const [ip, entry] of this.cache.entries()) {
      if (entry.identity && entry.identity.nodeId === deviceId) {
        this.cache.delete(ip);
      }
    }

    return result;
  }

  /**
   * Gera convite e chave pré-autenticada na Tailnet (RF-ID-01).
   */
  public async generateInviteKey(
    tags: string[],
    expirySeconds: number = 86400,
  ): Promise<PreAuthKeyResult> {
    return this.cloudDriver.generatePreAuthKey(tags, expirySeconds);
  }

  /**
   * Executa auditoria de postura declarativa das ACLs da Tailnet (RF-TS-01).
   */
  public async auditAclCompliance(): Promise<AclComplianceReport> {
    if (!this.postureService) {
      return {
        compliant: true,
        issues: [],
        auditedAt: new Date(),
      };
    }

    const audit = await this.postureService.auditBootPosture();
    return {
      compliant: audit.status === 'COMPLIANT',
      issues: audit.findings.map((f) => f.description),
      auditedAt: new Date(audit.timestamp),
    };
  }
}
