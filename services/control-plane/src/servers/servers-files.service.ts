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
import { serverDataDirectory } from '@k8s/server-data-volume';

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
    const serverDir = path.resolve(baseRoot, serverDataDirectory(server.subdomain));
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    return serverDir;
  }

  async listFiles(
    id: string,
    relPath: string = '',
  ): Promise<{ path: string; files: FileItemDto[] }> {
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
        'Security restriction: the session.lock file cannot be modified manually (RF-STO-09 / RF-ARQ-16)',
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

    return { message: 'Saved successfully' };
  }

  async deleteFile(id: string, relPath: string): Promise<{ message: string }> {
    if (!relPath || relPath.trim() === '') {
      throw new BadRequestException('Path parameter is required');
    }

    const normalizedRelPath = relPath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRelPath.endsWith('session.lock')) {
      throw new BadRequestException(
        'Security restriction: the session.lock file must never be deleted manually (RF-STO-09 / RF-ARQ-16)',
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
    return { message: 'Removed successfully' };
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
      message: 'Extraction completed successfully',
      extractedCount: extracted.length,
    };
  }

  async uploadFile(
    id: string,
    relPath: string = '',
    file?: { originalname: string; buffer: Buffer },
  ): Promise<{ message: string }> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No file provided or file is empty');
    }

    if (!file.originalname || file.originalname.trim() === '') {
      throw new BadRequestException('File name cannot be empty');
    }

    const filename = path.basename(file.originalname.trim());
    if (
      !filename ||
      filename === '.' ||
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('\0')
    ) {
      throw new BadRequestException('Invalid file name');
    }

    const fullRelPath = relPath ? path.join(relPath, filename).replace(/\\/g, '/') : filename;
    const normalizedRelPath = fullRelPath.toLowerCase();

    if (normalizedRelPath.endsWith('session.lock')) {
      throw new BadRequestException(
        'Security restriction: the session.lock file cannot be uploaded manually (RF-STO-09 / RF-ARQ-16)',
      );
    }

    const server = await this.getServer(id);
    const isWorldPath =
      normalizedRelPath.startsWith('world/') ||
      normalizedRelPath === 'world' ||
      normalizedRelPath.includes('/world/');
    if (isWorldPath && (server.state === 'READY' || server.state === 'STARTING')) {
      throw new ConflictException(
        `Cannot upload files to world directory while server is running (state: ${server.state}). Server must be in STOPPED state (RF-ARQ-16).`,
      );
    }

    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, fullRelPath);

    const parentDir = path.dirname(safePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    const tempPath = `${safePath}.tmp.${Date.now()}`;
    await fs.promises.writeFile(tempPath, file.buffer);
    await fs.promises.rename(tempPath, safePath);

    return { message: 'File uploaded successfully' };
  }

  async createDirectory(
    id: string,
    relPath: string = '',
    dirName: string,
  ): Promise<{ message: string }> {
    if (!dirName || dirName.trim() === '') {
      throw new BadRequestException('Directory name is required');
    }

    const trimmedName = dirName.trim();
    if (
      trimmedName === '.' ||
      trimmedName === '..' ||
      trimmedName.includes('/') ||
      trimmedName.includes('\\') ||
      trimmedName.includes('\0')
    ) {
      throw new BadRequestException('Invalid directory name');
    }

    const fullRelPath = relPath ? path.join(relPath, trimmedName).replace(/\\/g, '/') : trimmedName;
    const normalizedRelPath = fullRelPath.toLowerCase();

    const server = await this.getServer(id);
    const isWorldPath =
      normalizedRelPath.startsWith('world/') ||
      normalizedRelPath === 'world' ||
      normalizedRelPath.includes('/world/');
    if (isWorldPath && (server.state === 'READY' || server.state === 'STARTING')) {
      throw new ConflictException(
        `Cannot create directories inside world while server is running (state: ${server.state}). Server must be in STOPPED state (RF-ARQ-16).`,
      );
    }

    const baseDir = this.getServerDataDir(server);
    const safePath = resolveSafePath(baseDir, fullRelPath);

    if (fs.existsSync(safePath)) {
      throw new ConflictException(`Directory or file "${trimmedName}" already exists`);
    }

    await fs.promises.mkdir(safePath, { recursive: true });
    return { message: 'Directory created successfully' };
  }

  async renamePath(
    id: string,
    oldRelPath: string,
    newRelPath: string,
  ): Promise<{ message: string }> {
    if (!oldRelPath || oldRelPath.trim() === '' || !newRelPath || newRelPath.trim() === '') {
      throw new BadRequestException('Both old and new paths are required');
    }

    const normOld = oldRelPath.replace(/\\/g, '/').toLowerCase();
    const normNew = newRelPath.replace(/\\/g, '/').toLowerCase();

    if (normOld.endsWith('session.lock') || normNew.endsWith('session.lock')) {
      throw new BadRequestException(
        'Security restriction: session.lock cannot be renamed (RF-STO-09 / RF-ARQ-16)',
      );
    }

    const server = await this.getServer(id);
    const touchesWorld =
      normOld.startsWith('world/') ||
      normOld === 'world' ||
      normOld.includes('/world/') ||
      normNew.startsWith('world/') ||
      normNew === 'world' ||
      normNew.includes('/world/');

    if (touchesWorld && (server.state === 'READY' || server.state === 'STARTING')) {
      throw new ConflictException(
        `Cannot rename world files while server is running (state: ${server.state}). Server must be in STOPPED state (RF-ARQ-16).`,
      );
    }

    const baseDir = this.getServerDataDir(server);
    const oldSafePath = resolveSafePath(baseDir, oldRelPath);
    const newSafePath = resolveSafePath(baseDir, newRelPath);

    if (oldSafePath === baseDir) {
      throw new BadRequestException('Cannot rename root data directory');
    }

    if (!fs.existsSync(oldSafePath)) {
      throw new NotFoundException(`Path "${oldRelPath}" does not exist`);
    }

    if (fs.existsSync(newSafePath)) {
      throw new ConflictException(`Target "${newRelPath}" already exists`);
    }

    await fs.promises.mkdir(path.dirname(newSafePath), { recursive: true });
    await fs.promises.rename(oldSafePath, newSafePath);

    return { message: 'Renamed successfully' };
  }
}
