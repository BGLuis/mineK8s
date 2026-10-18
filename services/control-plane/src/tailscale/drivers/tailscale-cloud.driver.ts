import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { parseClientAddress } from '../identity/client-address';
import { NetworkIdentity, PreAuthKeyResult } from '../identity/network-identity-provider.interface';

export interface TailscaleCloudDevice {
  id: string;
  nodeId: string;
  name: string;
  user: string;
  addresses: string[];
  tags?: string[];
  lastSeen?: string;
  keyExpiryDisabled?: boolean;
}

@Injectable()
export class TailscaleCloudDriver {
  private readonly logger = new Logger(TailscaleCloudDriver.name);
  private overrides: { apiToken?: string; tailnet?: string } = {};
  private baseUrl: string;

  constructor(private readonly configService?: AppConfigService) {
    this.baseUrl = process.env.TAILSCALE_API_URL || 'https://api.tailscale.com';
  }

  /** Read on every request, so a key or tailnet saved on the settings page applies without a restart. */
  private get apiToken(): string {
    return (
      this.overrides.apiToken ??
      this.configService?.tailscale.apiKey ??
      process.env.TAILSCALE_API_KEY ??
      ''
    );
  }

  private get tailnet(): string {
    return (
      this.overrides.tailnet ??
      this.configService?.tailscale.tailnetName ??
      process.env.TAILNET_NAME ??
      process.env.TAILSCALE_TAILNET ??
      '-'
    );
  }

  public setConfig(token: string, tailnet: string, baseUrl?: string): void {
    this.overrides = { apiToken: token, tailnet };
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  /**
   * Executa requisição autenticada à API da Tailscale com suporte a rate limit (HTTP 429) e backoff.
   */
  private async requestWithRetry(
    endpoint: string,
    options: RequestInit = {},
    retries = 2,
  ): Promise<Response> {
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
        const delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 2 ** attempt;
        this.logger.warn(
          `Tailscale Cloud API 429 Rate Limit atingido em ${endpoint}. Aguardando ${delaySeconds}s (tentativa ${attempt + 1}/${retries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
        attempt++;
        continue;
      }

      return response;
    }

    throw new Error(`Failed after ${retries} attempts on the Cloud API: ${endpoint}`);
  }

  /**
   * Lista todos os dispositivos cadastrados na Tailnet (RF-TS-05, RF-TS-14).
   */
  public async getDevices(): Promise<TailscaleCloudDevice[]> {
    const resp = await this.requestWithRetry(`/api/v2/tailnet/${this.tailnet}/devices`);
    if (!resp.ok) {
      throw new Error(
        `Error listing devices on the Cloud API (${resp.status}): ${await resp.text()}`,
      );
    }
    const data = (await resp.json()) as { devices?: TailscaleCloudDevice[] };
    return data.devices || [];
  }

  /**
   * Encontra um dispositivo pelo endereço IP atribuído na Tailnet.
   */
  public async findDeviceByIp(ip: string): Promise<NetworkIdentity | null> {
    const cleanIp = parseClientAddress(ip);
    if (!cleanIp) {
      return null;
    }
    const devices = await this.getDevices();

    const match = devices.find((d) => d.addresses && d.addresses.includes(cleanIp));
    if (!match) {
      return null;
    }

    return {
      // `user` here is the login name, while users.tailscale_user_id holds the numeric ID from the LocalAPI WhoIs.
      // Nothing confirms the Users API `id` is that same number, so the user stays unknown and callers fall back
      // to the node ID, which both APIs report as the same stable ID.
      userId: '',
      loginName: match.user || '',
      displayName: match.name || '',
      nodeId: match.nodeId || match.id,
      nodeName: match.name || '',
      nodeIp: cleanIp,
      tags: match.tags || [],
      isOwner: (match.tags || []).length === 0,
    };
  }

  /**
   * Gera chave de autenticação pré-autorizada (AuthKey) vinculada a tags específicas (RF-TS-05, RF-ID-01).
   */
  public async generatePreAuthKey(
    tags: string[],
    expirySeconds: number = 86400,
  ): Promise<PreAuthKeyResult> {
    const body = {
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: false,
            preauthorized: true,
            tags,
          },
        },
      },
      expirySeconds,
    };

    const resp = await this.requestWithRetry(`/api/v2/tailnet/${this.tailnet}/keys`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(
        `Error generating AuthKey on the Cloud API (${resp.status}): ${await resp.text()}`,
      );
    }

    const data = (await resp.json()) as {
      key: string;
      id: string;
      expires: string;
      capabilities: any;
    };
    return {
      key: data.key,
      id: data.id,
      expires: new Date(data.expires),
      tags,
    };
  }

  /**
   * Exclui um dispositivo da Tailnet (Nível 2 de Revogação - RF-TS-07).
   */
  public async deleteDevice(deviceId: string): Promise<boolean> {
    const resp = await this.requestWithRetry(`/api/v2/device/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    });
    return resp.ok;
  }

  /**
   * Obtém as políticas de ACL vigentes da Tailnet para auditoria (RF-TS-01).
   */
  public async fetchAcl(): Promise<any> {
    const resp = await this.requestWithRetry(`/api/v2/tailnet/${this.tailnet}/acl`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`Error fetching ACL on the Cloud API (${resp.status}): ${await resp.text()}`);
    }
    return await resp.json();
  }
}
