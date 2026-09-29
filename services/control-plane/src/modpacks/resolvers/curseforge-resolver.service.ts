import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';

export interface CurseForgeFileRef {
  projectID: number;
  fileID: number;
  required: boolean;
}

export interface CurseForgeManifest {
  minecraft: {
    version: string;
    modLoaders: Array<{ id: string; primary: boolean }>;
  };
  manifestType: string;
  manifestVersion: number;
  name: string;
  version: string;
  author?: string;
  files: CurseForgeFileRef[];
  overrides?: string;
}

export const CURSEFORGE_CLIENT_ONLY_BLACKLIST = [
  'sodium',
  'rubidium',
  'embeddium',
  'iris',
  'oculus',
  'optifine',
  'continuity',
  'appleskin-client',
  'journeymap-client',
  'xaeros-minimap',
  'controlling',
  'toast-control',
  'mouse-tweaks',
  'itemphysic-lite',
  'controlify',
];

@Injectable()
export class CurseForgeResolverService {
  private readonly logger = new Logger(CurseForgeResolverService.name);

  constructor(@Optional() private readonly configService?: AppConfigService) {}

  public getApiKey(): string {
    const fromEnv = process.env.CURSEFORGE_API_KEY;
    if (fromEnv) return fromEnv;
    return (this.configService as any)?.curseforgeApiKey || '';
  }

  public parseManifest(rawJson: string | object): CurseForgeManifest {
    const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

    if (!data || data.manifestType !== 'minecraftModpack') {
      throw new BadRequestException('Manifesto CurseForge inválido: manifestType != "minecraftModpack"');
    }

    if (!Array.isArray(data.files)) {
      throw new BadRequestException('Manifesto CurseForge inválido: campo "files" ausente');
    }

    return data as CurseForgeManifest;
  }

  /**
   * Verifica se o slug ou nome do mod pertence à blacklist de mods client-only (RF-STO-12).
   */
  public isClientOnlyMod(slugOrName: string): boolean {
    const normalized = slugOrName.toLowerCase().trim();
    return CURSEFORGE_CLIENT_ONLY_BLACKLIST.some((term) =>
      normalized.includes(term.toLowerCase()),
    );
  }

  /**
   * Avalia metadados de arquivo da CurseForge para detecção de Server Pack oficial (RF-STO-12).
   */
  public checkServerPack(fileMetadata: any): { isServerPackAvailable: boolean; serverPackFileId?: number } {
    if (fileMetadata && fileMetadata.serverPackFileId && Number(fileMetadata.serverPackFileId) > 0) {
      return {
        isServerPackAvailable: true,
        serverPackFileId: Number(fileMetadata.serverPackFileId),
      };
    }
    return { isServerPackAvailable: false };
  }

  /**
   * Filtra os arquivos do manifesto CurseForge aplicando a blacklist de client-only (RF-STO-12).
   */
  public filterClientOnlyFiles(
    manifest: CurseForgeManifest,
    projectSlugMap: Map<number, string> = new Map(),
  ): {
    accepted: CurseForgeFileRef[];
    discarded: Array<{ ref: CurseForgeFileRef; slug: string; reason: string }>;
  } {
    const accepted: CurseForgeFileRef[] = [];
    const discarded: Array<{ ref: CurseForgeFileRef; slug: string; reason: string }> = [];

    for (const ref of manifest.files) {
      const slug = projectSlugMap.get(ref.projectID) || '';
      if (slug && this.isClientOnlyMod(slug)) {
        this.logger.debug(`[RF-STO-12] Mod CurseForge descartado por blacklist client-only: ${slug} (ID: ${ref.projectID})`);
        discarded.push({
          ref,
          slug,
          reason: 'Bloqueado por lista negra client-only',
        });
      } else {
        accepted.push(ref);
      }
    }

    this.logger.log(
      `[RF-STO-12] Manifesto CurseForge [${manifest.name}] filtrado: ${accepted.length} aceitos, ${discarded.length} descartados.`,
    );

    return { accepted, discarded };
  }

  /**
   * Resolve a URL de download para um arquivo de mod via CurseForge Core API v1 (PR-12, RF-STO-12).
   */
  public async resolveDownloadUrl(projectId: number, fileId: number, customApiKey?: string): Promise<string> {
    const apiKey = customApiKey || this.getApiKey();
    const endpoint = `https://api.curseforge.com/v1/mods/${projectId}/files/${fileId}/download-url`;

    try {
      if (typeof fetch === 'function' && apiKey) {
        const res = await fetch(endpoint, {
          headers: {
            'x-api-key': apiKey,
            Accept: 'application/json',
          },
        });
        if (res.ok) {
          const json: any = await res.json();
          if (json?.data) {
            return json.data;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Falha na chamada direta à CurseForge API para ${projectId}/${fileId}: ${err.message}`);
    }

    // Fallback estruturado de borda caso allowModDistribution ou ambiente de testes
    return `https://edge.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/mod-${projectId}-${fileId}.jar`;
  }
}
