import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as yauzl from 'yauzl';
import { resolveSafePath } from '@servers/security/path-traversal.validator';

export interface ModrinthIndexFile {
  path: string;
  hashes: {
    sha1?: string;
    sha512?: string;
    sha256?: string;
  };
  env?: {
    client?: 'required' | 'optional' | 'unsupported';
    server?: 'required' | 'optional' | 'unsupported';
  };
  downloads: string[];
  fileSize?: number;
}

export interface ModrinthIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  summary?: string;
  dependencies: {
    minecraft?: string;
    'fabric-loader'?: string;
    forge?: string;
    neoforge?: string;
    'quilt-loader'?: string;
    [key: string]: string | undefined;
  };
  files: ModrinthIndexFile[];
}

export interface ModrinthResolutionResult {
  packName: string;
  gameVersion: string;
  loaderType?: string;
  loaderVersion?: string;
  acceptedFiles: ModrinthIndexFile[];
  discardedFiles: ModrinthIndexFile[];
}

@Injectable()
export class ModrinthResolverService {
  private readonly logger = new Logger(ModrinthResolverService.name);

  /**
   * Realiza parse e validação do modrinth.index.json.
   */
  public parseIndex(rawJson: string | object): ModrinthIndex {
    const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

    if (!data || data.game !== 'minecraft') {
      throw new BadRequestException(
        'Invalid Modrinth manifest or incompatible game (game != "minecraft")',
      );
    }

    if (!Array.isArray(data.files)) {
      throw new BadRequestException('Invalid Modrinth manifest: "files" field missing or invalid');
    }

    return data as ModrinthIndex;
  }

  /**
   * Filtra rigorosamente os arquivos a serem instalados no servidor headless (RF-STO-11).
   * CRITÉRIO DE ACEITE: Se file.env?.server === "unsupported", o mod NUNCA é baixado.
   */
  public resolveServerFiles(index: ModrinthIndex): ModrinthResolutionResult {
    const acceptedFiles: ModrinthIndexFile[] = [];
    const discardedFiles: ModrinthIndexFile[] = [];

    for (const file of index.files) {
      const serverEnv = file.env?.server;

      // Descarte inegociável de mods client-only (Sodium, Iris, Indium, etc.)
      if (serverEnv === 'unsupported') {
        this.logger.debug(`[RF-STO-11] Descartando mod com env.server=unsupported: ${file.path}`);
        discardedFiles.push(file);
      } else {
        // "required", "optional" ou indefinido -> aceito para download do servidor
        acceptedFiles.push(file);
      }
    }

    // Identifica Loader predominante (Fabric, Forge, NeoForge, Quilt)
    const deps = index.dependencies || {};
    let loaderType: string | undefined;
    let loaderVersion: string | undefined;

    if (deps['fabric-loader']) {
      loaderType = 'fabric';
      loaderVersion = deps['fabric-loader'];
    } else if (deps['neoforge']) {
      loaderType = 'neoforge';
      loaderVersion = deps['neoforge'];
    } else if (deps['forge']) {
      loaderType = 'forge';
      loaderVersion = deps['forge'];
    } else if (deps['quilt-loader']) {
      loaderType = 'quilt';
      loaderVersion = deps['quilt-loader'];
    }

    this.logger.log(
      `[RF-STO-11] Modpack Modrinth [${index.name}] resolvido: ${acceptedFiles.length} aceitos, ${discardedFiles.length} descartados (env.server=unsupported).`,
    );

    return {
      packName: index.name,
      gameVersion: deps.minecraft || '1.20.1',
      loaderType,
      loaderVersion,
      acceptedFiles,
      discardedFiles,
    };
  }

  /**
   * Extrai o modrinth.index.json a partir do arquivo ZIP .mrpack.
   */
  public async extractIndexFromMrpack(mrpackBuffer: Buffer): Promise<ModrinthIndex> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(mrpackBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          return reject(new BadRequestException(`Failed to open .mrpack: ${err?.message}`));
        }

        let indexFound = false;
        zipfile.readEntry();

        zipfile.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName === 'modrinth.index.json') {
            indexFound = true;
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) {
                zipfile.close();
                return reject(
                  new BadRequestException(
                    `Failed to read modrinth.index.json: ${streamErr?.message}`,
                  ),
                );
              }

              const chunks: Buffer[] = [];
              readStream.on('data', (c) => chunks.push(c));
              readStream.on('end', () => {
                try {
                  const content = Buffer.concat(chunks).toString('utf-8');
                  const parsed = this.parseIndex(content);
                  zipfile.close();
                  resolve(parsed);
                } catch (parseErr) {
                  zipfile.close();
                  reject(parseErr);
                }
              });
              readStream.on('error', (e) => {
                zipfile.close();
                reject(e);
              });
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on('end', () => {
          if (!indexFound) {
            reject(new BadRequestException('modrinth.index.json not found inside the .mrpack'));
          }
        });
      });
    });
  }

  /**
   * Extrai os arquivos contidos na pasta overrides/ dentro do .mrpack para o diretório de destino (/data).
   */
  public async extractOverrides(mrpackBuffer: Buffer, targetDir: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(mrpackBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          return reject(
            new BadRequestException(`Failed to open .mrpack for overrides: ${err?.message}`),
          );
        }

        const extractedPaths: string[] = [];
        zipfile.readEntry();

        zipfile.on('entry', async (entry: yauzl.Entry) => {
          // Verifica se está dentro de overrides/ ou server-overrides/
          let relativePath: string | null = null;
          if (entry.fileName.startsWith('overrides/')) {
            relativePath = entry.fileName.replace(/^overrides\//, '');
          } else if (entry.fileName.startsWith('server-overrides/')) {
            relativePath = entry.fileName.replace(/^server-overrides\//, '');
          }

          if (!relativePath || relativePath === '') {
            zipfile.readEntry();
            return;
          }

          try {
            const destPath = resolveSafePath(targetDir, relativePath);

            if (/\/$/.test(entry.fileName)) {
              await fs.promises.mkdir(destPath, { recursive: true });
              zipfile.readEntry();
              return;
            }

            await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) {
                zipfile.close();
                return reject(streamErr);
              }

              const out = fs.createWriteStream(destPath);
              readStream.pipe(out);
              out.on('finish', () => {
                extractedPaths.push(destPath);
                zipfile.readEntry();
              });
              out.on('error', (e) => {
                zipfile.close();
                reject(e);
              });
            });
          } catch (e) {
            zipfile.close();
            reject(e);
          }
        });

        zipfile.on('end', () => {
          resolve(extractedPaths);
        });
      });
    });
  }
}
