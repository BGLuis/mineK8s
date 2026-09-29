import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';

import { FileItemDto } from './dto/file-item.dto';
import { ArchiveExtractor } from './security/archive-extractor';
import { resolveSafePath } from './security/path-traversal.validator';

@Injectable()
export class ServersFilesService {
  private readonly logger = new Logger(ServersFilesService.name);

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly configService: AppConfigService,
  ) {}

  private async getServer(id: string): Promise<Server> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }
    return server;
  }

  public getServerDataDir(server: Server): string {
    const baseRoot = path.resolve(this.configService.storage.serversDataRoot);
    const serverDir = path.resolve(baseRoot, server.subdomain);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }

  async listFiles(id: string, relPath: string = ''): Promise<{ path: string; files: FileItemDto[] }> {
    const server = await this.getServer(id);
    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, relPath);

    if (!fs.existsSync(safePath)) {
      throw new NotFoundException(`Path "${relPath}" does not exist`);
    }

    const stat = await fs.promises.stat(safePath);
    if (!stat.isDirectory()) {
      throw new BadRequestException(`Path "${relPath}" is a file, not a directory`);
    }

    const entries = await fs.promises.readdir(safePath, { withFileTypes: true });
    const files: FileItemDto[] = [];

    for (const entry of entries) {
      const entryAbs = path.join(safePath, entry.name);
      const entryStat = await fs.promises.stat(entryAbs);
      const entryRel = path.relative(baseDir, entryAbs).replace(/\\/g, '/');

      files.push({
        name: entry.name,
        path: entryRel,
        isDirectory: entry.isDirectory(),
        size: entryStat.size,
        modifiedAt: entryStat.mtime,
      });
    }

    return { path: relPath, files };
  }

  async readFile(id: string, relPath: string): Promise<{ path: string; content: string }> {
    if (!relPath || relPath.trim() === '') {
      throw new BadRequestException('Path parameter is required');
    }

    const server = await this.getServer(id);
    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, relPath);

    if (!fs.existsSync(safePath)) {
      throw new NotFoundException(`File "${relPath}" does not exist`);
    }

    const stat = await fs.promises.stat(safePath);
    if (stat.isDirectory()) {
      throw new BadRequestException(`Target "${relPath}" is a directory, not a file`);
    }

    const content = await fs.promises.readFile(safePath, 'utf-8');
    return { path: relPath, content };
  }

  async writeFile(id: string, relPath: string, content: string): Promise<{ message: string }> {
    if (!relPath || relPath.trim() === '') {
      throw new BadRequestException('Path parameter is required');
    }

    const normalizedRelPath = relPath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRelPath.endsWith('session.lock')) {
      throw new BadRequestException(
        'Proibição de segurança: o arquivo session.lock não pode ser manipulado manualmente (RF-STO-09 / RF-ARQ-16)',
      );
    }

    const server = await this.getServer(id);
    const isWorldPath = normalizedRelPath.startsWith('world/') || normalizedRelPath === 'world';
    if (isWorldPath && (server.state === 'READY' || server.state === 'STARTING')) {
      throw new ConflictException(
        `Cannot modify world files while server is running (state: ${server.state}). Server must be in STOPPED state (RF-ARQ-16).`,
      );
    }

    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, relPath);

    const parentDir = path.dirname(safePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    // Atomic write using temp file and rename
    const tempPath = `${safePath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, content ?? '', 'utf-8');
    await fs.promises.rename(tempPath, safePath);

    return { message: 'Salvo com sucesso' };
  }

  async deleteFile(id: string, relPath: string): Promise<{ message: string }> {
    if (!relPath || relPath.trim() === '') {
      throw new BadRequestException('Path parameter is required');
    }

    const normalizedRelPath = relPath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRelPath.endsWith('session.lock')) {
      throw new BadRequestException(
        'Proibição de segurança: o arquivo session.lock nunca deve ser deletado manualmente (RF-STO-09 / RF-ARQ-16)',
      );
    }

    const server = await this.getServer(id);
    const isWorldPath = normalizedRelPath.startsWith('world/') || normalizedRelPath === 'world';
    if (isWorldPath && (server.state === 'READY' || server.state === 'STARTING')) {
      throw new ConflictException(
        `Cannot delete world files while server is running (state: ${server.state}). Server must be in STOPPED state (RF-ARQ-16).`,
      );
    }

    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, relPath);

    if (safePath === baseDir) {
      throw new BadRequestException('Cannot delete root data directory');
    }

    if (!fs.existsSync(safePath)) {
      throw new NotFoundException(`Path "${relPath}" does not exist`);
    }

    await fs.promises.rm(safePath, { recursive: true, force: true });
    return { message: 'Removido com sucesso' };
  }

  async uploadWorld(
    id: string,
    file?: { originalname: string; buffer: Buffer },
  ): Promise<{ message: string; extractedCount: number }> {
    const server = await this.getServer(id);

    // Acceptance criterion: upload with active server -> 409 Conflict
    if (server.state === 'READY' || server.state === 'STARTING') {
      throw new ConflictException(
        `Cannot upload world while server is active (state: ${server.state}). Server must be in STOPPED state.`,
      );
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No world file provided or uploaded file is empty');
    }

    const baseDir = this.getServerDataDir(server);
    const originalName = file.originalname.toLowerCase();

    let extracted: string[] = [];

    if (originalName.endsWith('.zip')) {
      extracted = await ArchiveExtractor.extractZip(file.buffer, baseDir);
    } else if (originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz')) {
      extracted = await ArchiveExtractor.extractTar(file.buffer, baseDir, true);
    } else if (originalName.endsWith('.tar')) {
      extracted = await ArchiveExtractor.extractTar(file.buffer, baseDir, false);
    } else {
      throw new BadRequestException(
        'Unsupported archive format. Supported formats: .zip, .tar, .tar.gz, .tgz',
      );
    }

    this.logger.log(
      `Successfully extracted world archive for server [${server.subdomain}]: ${extracted.length} files/dirs.`,
    );

    return {
      message: 'Extração concluída com sucesso',
      extractedCount: extracted.length,
    };
  }
}
