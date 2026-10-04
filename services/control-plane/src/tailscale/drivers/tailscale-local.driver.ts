import * as http from 'http';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { NetworkIdentity } from '../identity/network-identity-provider.interface';
import {
  LocalSocketUnavailableException,
  TailscaleWhoIsResponse,
} from '../identity/tailscale-whois.types';

@Injectable()
export class TailscaleLocalDriver {
  private readonly logger = new Logger(TailscaleLocalDriver.name);
  private socketPath: string;

  constructor(private readonly configService?: AppConfigService) {
    this.socketPath =
      process.env.TAILSCALE_SOCKET_PATH ||
      (this.configService as any)?.get?.('TAILSCALE_SOCKET_PATH') ||
      '/run/tailscale/tailscaled.sock';
  }

  public setSocketPath(path: string): void {
    this.socketPath = path;
  }

  public getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Consulta a LocalAPI do Tailscale daemon local via Unix Domain Socket (RF-GW-08, RF-TS-05).
   * Deve responder em sub-milissegundos (< 5ms).
   */
  public async queryWhoIs(ip: string): Promise<NetworkIdentity | null> {
    const formattedAddr = ip.includes(':') ? ip : `${ip}:0`;
    const path = `/localapi/v0/whois?addr=${encodeURIComponent(formattedAddr)}`;

    return new Promise<NetworkIdentity | null>((resolve, reject) => {
      const startTime = Date.now();

      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method: 'GET',
          headers: {
            Host: 'local-tailscaled.sock',
          },
          timeout: 1500,
        },
        (res) => {
          let rawData = '';

          res.on('data', (chunk) => {
            rawData += chunk;
          });

          res.on('end', () => {
            const elapsed = Date.now() - startTime;
            if (res.statusCode === 404) {
              return resolve(null);
            }

            if (res.statusCode !== 200) {
              return reject(
                new Error(
                  `Tailscale LocalAPI WhoIs retornou status ${res.statusCode}: ${rawData}`,
                ),
              );
            }

            try {
              const whois = JSON.parse(rawData) as TailscaleWhoIsResponse;
              const identity = this.mapWhoIsToIdentity(whois, ip);
              this.logger.debug(
                `WhoIs resolvido em ${elapsed}ms para ${ip} (user: ${identity.loginName})`,
              );
              resolve(identity);
            } catch (err: any) {
              reject(
                new Error(`Failed to decode WhoIs JSON: ${err.message}`),
              );
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('Timeout de 1500ms na consulta ao Tailscale LocalAPI'));
      });

      req.on('error', (err: any) => {
        if (
          err.code === 'ENOENT' ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENOTSOCK' ||
          err.code === 'EACCES'
        ) {
          return reject(
            new LocalSocketUnavailableException(
              `Local Tailscale socket not available at ${this.socketPath} (${err.code}): ${err.message}`,
              err.code,
            ),
          );
        }
        reject(err);
      });

      req.end();
    });
  }

  /**
   * Verifica a conectividade com o daemon local do Tailscale.
   */
  public async pingDaemon(): Promise<boolean> {
    try {
      return await new Promise<boolean>((resolve) => {
        const req = http.request(
          {
            socketPath: this.socketPath,
            path: '/localapi/v0/status',
            method: 'GET',
            headers: { Host: 'local-tailscaled.sock' },
            timeout: 1000,
          },
          (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          },
        );

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });
    } catch {
      return false;
    }
  }

  private mapWhoIsToIdentity(
    whois: TailscaleWhoIsResponse,
    queryIp: string,
  ): NetworkIdentity {
    const node = whois.Node || {};
    const user = whois.UserProfile || {};

    return {
      userId: String(user.ID ?? ''),
      loginName: user.LoginName ?? '',
      displayName: user.DisplayName ?? '',
      nodeId: node.StableID ?? String(node.ID ?? ''),
      nodeName: node.Name ?? '',
      nodeIp: queryIp,
      tags: node.Tags ?? [],
      isOwner: (node.Tags ?? []).length === 0, // Nós com tags são tagged nodes, sem tags pertencem diretamente ao usuário
    };
  }
}
