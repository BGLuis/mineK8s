import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  DnsRecordFilter,
  DnsRecordInput,
  DnsRecordResult,
  IDnsDriver,
} from '../interfaces/dns-driver.interface';

export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
}

@Injectable()
export class CloudflareDnsDriver implements IDnsDriver {
  private readonly logger = new Logger(CloudflareDnsDriver.name);
  private apiToken: string;
  private zoneId: string;
  private rootDomain: string;
  private baseUrl: string;

  constructor(private readonly configService?: AppConfigService) {
    this.apiToken =
      process.env.CLOUDFLARE_API_TOKEN ||
      this.configService?.cloudflare?.apiToken ||
      '';
    this.zoneId =
      process.env.CLOUDFLARE_ZONE_ID ||
      this.configService?.cloudflare?.zoneId ||
      '';
    this.rootDomain =
      process.env.CLOUDFLARE_ROOT_DOMAIN ||
      this.configService?.cloudflare?.rootDomain ||
      'minek8s.net';
    this.baseUrl =
      process.env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com/client/v4';
  }

  public setConfig(apiToken: string, zoneId: string, rootDomain?: string, baseUrl?: string): void {
    this.apiToken = apiToken;
    this.zoneId = zoneId;
    if (rootDomain) {
      this.rootDomain = rootDomain;
    }
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  public getRootDomain(): string {
    return this.rootDomain;
  }

  /**
   * Executa requisição autenticada à API da Cloudflare com suporte a rate limit (HTTP 429) e backoff.
   */
  private async requestWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 2,
  ): Promise<CloudflareApiResponse<T>> {
    if (!this.apiToken || !this.zoneId) {
      throw new Error(
        'CloudflareDnsDriver não configurado: CLOUDFLARE_API_TOKEN ou CLOUDFLARE_ZONE_ID ausentes.',
      );
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    let attempt = 0;
    while (attempt <= retries) {
      const response = await fetch(url, { ...options, headers });

      if (response.status === 429 && attempt < retries) {
        const retryAfterHeader = response.headers.get('retry-after');
        const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : Math.pow(2, attempt);
        this.logger.warn(
          `Cloudflare API 429 Rate Limit atingido em ${endpoint}. Aguardando ${delaySeconds}s (tentativa ${attempt + 1}/${retries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
        attempt++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro na API Cloudflare (${response.status}) em ${endpoint}: ${errorText}`);
      }

      const data = (await response.json()) as CloudflareApiResponse<T>;
      if (!data.success) {
        const msg = (data.errors || []).map((e) => `[${e.code}] ${e.message}`).join(', ');
        throw new Error(`Cloudflare API retornou erro em ${endpoint}: ${msg}`);
      }

      return data;
    }

    throw new Error(`Falha após ${retries} tentativas na API Cloudflare: ${endpoint}`);
  }

  /**
   * Lista registros DNS da zona com filtros opcionais (RF-TS-16, RF-CF-06).
   */
  public async listRecords(filter?: DnsRecordFilter): Promise<DnsRecordResult[]> {
    const params = new URLSearchParams();
    if (filter?.type) {
      params.append('type', filter.type);
    }
    if (filter?.name) {
      params.append('name', filter.name);
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    const resp = await this.requestWithRetry<any[]>(`/zones/${this.zoneId}/dns_records${query}`, {
      method: 'GET',
    });

    return (resp.result || []).map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
      data: r.data,
    }));
  }

  /**
   * Cria um novo registro DNS na zona Cloudflare.
   */
  public async createRecord(record: DnsRecordInput): Promise<DnsRecordResult> {
    const payload: any = {
      type: record.type,
      name: record.name,
      ttl: record.ttl ?? 1, // 1 = automático na Cloudflare
      proxied: record.proxied ?? false,
    };

    if (record.content) {
      payload.content = record.content;
    }
    if (record.priority !== undefined) {
      payload.priority = record.priority;
    }
    if (record.data) {
      payload.data = record.data;
    }

    const resp = await this.requestWithRetry<any>(`/zones/${this.zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const r = resp.result;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
      data: r.data,
    };
  }

  /**
   * Atualiza um registro DNS existente na Cloudflare.
   */
  public async updateRecord(recordId: string, record: DnsRecordInput): Promise<DnsRecordResult> {
    const payload: any = {
      type: record.type,
      name: record.name,
      ttl: record.ttl ?? 1,
      proxied: record.proxied ?? false,
    };

    if (record.content) {
      payload.content = record.content;
    }
    if (record.priority !== undefined) {
      payload.priority = record.priority;
    }
    if (record.data) {
      payload.data = record.data;
    }

    const resp = await this.requestWithRetry<any>(`/zones/${this.zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const r = resp.result;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
      data: r.data,
    };
  }

  /**
   * Exclui um registro DNS pelo ID.
   */
  public async deleteRecord(recordId: string): Promise<boolean> {
    const resp = await this.requestWithRetry<{ id: string }>(
      `/zones/${this.zoneId}/dns_records/${recordId}`,
      { method: 'DELETE' },
    );
    return !!resp.result?.id;
  }

  /**
   * Exclui registros DNS correspondentes a um nome e tipo (idempotente).
   */
  public async deleteRecordByNameAndType(name: string, type: string): Promise<boolean> {
    const records = await this.listRecords({ name, type });
    if (records.length === 0) {
      return false;
    }

    for (const record of records) {
      await this.deleteRecord(record.id);
    }
    return true;
  }

  /**
   * Cria ou atualiza registro A wildcard (*.dominio) apontando para o IP público (RF-TS-16, RF-CF-06).
   */
  public async upsertWildcardA(domain: string, publicIp: string): Promise<DnsRecordResult> {
    const wildcardName = domain.startsWith('*.') ? domain : `*.${domain}`;
    const existing = await this.listRecords({ type: 'A', name: wildcardName });

    if (existing.length > 0) {
      const current = existing[0];
      if (current.content === publicIp) {
        return current;
      }
      return await this.updateRecord(current.id, {
        type: 'A',
        name: wildcardName,
        content: publicIp,
        ttl: 1,
        proxied: false,
      });
    }

    return await this.createRecord({
      type: 'A',
      name: wildcardName,
      content: publicIp,
      ttl: 1,
      proxied: false,
    });
  }

  /**
   * Cria ou atualiza registro SRV _minecraft._tcp.<name> apontando para o alvo (RF-CF-05, RF-CF-07).
   */
  public async upsertSrvRecord(
    name: string,
    target: string,
    port: number,
    priority = 0,
    weight = 5,
  ): Promise<DnsRecordResult> {
    const srvFullName = name.startsWith('_minecraft._tcp.') ? name : `_minecraft._tcp.${name}`;
    const existing = await this.listRecords({ type: 'SRV', name: srvFullName });

    const srvData = {
      service: '_minecraft',
      proto: '_tcp',
      name: name.replace(/^_minecraft\._tcp\./, ''),
      priority,
      weight,
      port,
      target,
    };

    if (existing.length > 0) {
      return await this.updateRecord(existing[0].id, {
        type: 'SRV',
        name: srvFullName,
        data: srvData,
        ttl: 1,
        proxied: false,
      });
    }

    return await this.createRecord({
      type: 'SRV',
      name: srvFullName,
      data: srvData,
      ttl: 1,
      proxied: false,
    });
  }
}
