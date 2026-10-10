import * as fs from 'node:fs';
import * as path from 'node:path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { serverDataDirectory } from '@k8s/server-data-volume';

/** The file Minecraft reads from the server directory and shows in the client's server list. */
export const SERVER_ICON_FILE = 'server-icon.png';
/** Minecraft only accepts 64x64. */
export const SERVER_ICON_SIZE = 64;
/** A 64x64 PNG is a few KB; the cap keeps a bogus upload out of the gateway's route events. */
export const MAX_SERVER_ICON_BYTES = 100 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;
const IHDR_END = 24;

/** Rejects anything the Minecraft client would not draw: not a PNG, or not 64x64. */
export function assertValidServerIcon(buffer: Buffer | undefined): asserts buffer is Buffer {
  if (!buffer?.length) {
    throw new BadRequestException('No image provided');
  }
  if (buffer.length > MAX_SERVER_ICON_BYTES) {
    throw new BadRequestException(`The icon must be at most ${MAX_SERVER_ICON_BYTES / 1024} KB`);
  }
  const isPng =
    buffer.length >= IHDR_END &&
    buffer.subarray(0, 8).equals(PNG_SIGNATURE) &&
    buffer.toString('ascii', 12, 16) === 'IHDR';
  if (!isPng) {
    throw new BadRequestException('The icon must be a PNG image');
  }
  const width = buffer.readUInt32BE(IHDR_WIDTH_OFFSET);
  const height = buffer.readUInt32BE(IHDR_HEIGHT_OFFSET);
  if (width !== SERVER_ICON_SIZE || height !== SERVER_ICON_SIZE) {
    throw new BadRequestException(
      `The icon must be ${SERVER_ICON_SIZE}x${SERVER_ICON_SIZE} pixels (got ${width}x${height})`,
    );
  }
}

/** Stores the server list icon next to the world, where the Minecraft server reads it. */
@Injectable()
export class ServerIconService {
  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly config: AppConfigService,
  ) {}

  async get(id: string): Promise<Buffer> {
    const icon = await this.read(await this.getServer(id));
    if (!icon) {
      throw new NotFoundException('This server has no icon');
    }
    return icon;
  }

  async set(id: string, buffer: Buffer | undefined): Promise<void> {
    assertValidServerIcon(buffer);
    const file = this.iconPath(await this.getServer(id));
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp.${Date.now()}`;
    await fs.promises.writeFile(temporary, buffer);
    await fs.promises.rename(temporary, file);
  }

  async remove(id: string): Promise<void> {
    await fs.promises.rm(this.iconPath(await this.getServer(id)), { force: true });
  }

  /** `data:image/png;base64,...` as the status response carries it; null when there is no icon. */
  async dataUri(server: Server): Promise<string | null> {
    const icon = await this.read(server);
    return icon ? `data:image/png;base64,${icon.toString('base64')}` : null;
  }

  private async read(server: Server): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.iconPath(server));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  private iconPath(server: Server): string {
    return path.join(
      path.resolve(this.config.storage.serversDataRoot),
      serverDataDirectory(server.resource_name),
      SERVER_ICON_FILE,
    );
  }

  private async getServer(id: string): Promise<Server> {
    const server = await this.serverRepo.findOne({ where: { id } });
    if (!server) {
      throw new NotFoundException(`Server with ID "${id}" not found`);
    }
    return server;
  }
}
