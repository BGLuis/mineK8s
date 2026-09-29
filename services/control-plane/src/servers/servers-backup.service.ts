import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';

@Injectable()
export class ServersBackupService {
  private readonly logger = new Logger(ServersBackupService.name);

  constructor(private readonly configService: AppConfigService) {}

  public getServerDataDir(server: Server): string {
    const baseRoot = path.resolve(this.configService.storage.serversDataRoot);
    const serverDir = path.resolve(baseRoot, server.subdomain);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }

  /**
   * Cria backup preventivo obrigatório (pre-update) antes de mutações de versão (RF-STO-13).
   * Retorna o caminho absoluto do diretório de backup gerado.
   */
  async createPreUpdateBackup(server: Server): Promise<string> {
    const serverDir = this.getServerDataDir(server);
    const backupsDir = path.join(serverDir, '.backups');
    const timestamp = Date.now();
    const targetBackupDir = path.join(backupsDir, `pre-update-${timestamp}`);

    this.logger.log(
      `Criando backup preventivo pre-update para servidor [${server.subdomain}] em: ${targetBackupDir}`,
    );

    await fs.promises.mkdir(targetBackupDir, { recursive: true });

    // Copia recursiva de todos os itens em serverDir, exceto a pasta .backups
    const entries = await fs.promises.readdir(serverDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.backups') {
        continue;
      }
      const srcPath = path.join(serverDir, entry.name);
      const destPath = path.join(targetBackupDir, entry.name);

      await this.copyRecursive(srcPath, destPath);
    }

    this.logger.log(
      `Backup pre-update concluído com sucesso para [${server.subdomain}].`,
    );
    return targetBackupDir;
  }

  /**
   * Restaura o backup pre-update em caso de falha no boot ou health check (RF-STO-13).
   */
  async restorePreUpdateBackup(server: Server, backupDir: string): Promise<void> {
    const serverDir = this.getServerDataDir(server);

    this.logger.warn(
      `Restaurando backup pre-update para servidor [${server.subdomain}] de ${backupDir}...`,
    );

    if (!fs.existsSync(backupDir)) {
      throw new Error(`Diretório de backup pre-update não encontrado: ${backupDir}`);
    }

    // Remove arquivos atuais do servidor (exceto .backups)
    const currentEntries = await fs.promises.readdir(serverDir, { withFileTypes: true });
    for (const entry of currentEntries) {
      if (entry.name === '.backups') {
        continue;
      }
      const itemPath = path.join(serverDir, entry.name);
      await fs.promises.rm(itemPath, { recursive: true, force: true });
    }

    // Copia os arquivos do backup de volta para o diretório do servidor
    const backupEntries = await fs.promises.readdir(backupDir, { withFileTypes: true });
    for (const entry of backupEntries) {
      const srcPath = path.join(backupDir, entry.name);
      const destPath = path.join(serverDir, entry.name);
      await this.copyRecursive(srcPath, destPath);
    }

    this.logger.log(
      `Rollback de arquivos concluído com sucesso para [${server.subdomain}].`,
    );
  }

  /**
   * Purga segura da pasta de mods (RF-STO-13):
   * Remove com segurança o conteúdo de mods/ sem tocar em world/, configs ou propriedades.
   */
  async purgeModsDirectory(server: Server): Promise<void> {
    const serverDir = this.getServerDataDir(server);
    const modsDir = path.join(serverDir, 'mods');

    if (!fs.existsSync(modsDir)) {
      this.logger.debug(`Pasta mods não existe em [${server.subdomain}], pulando purga.`);
      return;
    }

    this.logger.log(`Purgando diretório mods/ para servidor [${server.subdomain}] (RF-STO-13)...`);
    const entries = await fs.promises.readdir(modsDir);
    for (const entry of entries) {
      const entryPath = path.join(modsDir, entry);
      await fs.promises.rm(entryPath, { recursive: true, force: true });
    }
  }

  private async copyRecursive(src: string, dest: string): Promise<void> {
    const stat = await fs.promises.stat(src);
    if (stat.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const children = await fs.promises.readdir(src);
      for (const child of children) {
        await this.copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      const parent = path.dirname(dest);
      if (!fs.existsSync(parent)) {
        await fs.promises.mkdir(parent, { recursive: true });
      }
      await fs.promises.copyFile(src, dest);
    }
  }
}
