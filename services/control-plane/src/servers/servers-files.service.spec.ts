import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Server } from '@database/entities/server.entity';
import { ServersFilesService } from './servers-files.service';

function createMockZip(files: Array<{ name: string; content: string }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf-8');
    const contentBuf = Buffer.from(file.content || '', 'utf-8');
    const crc = (zlib as any).crc32(contentBuf);

    const local = Buffer.alloc(30 + filenameBuf.length + contentBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contentBuf.length, 18);
    local.writeUInt32LE(contentBuf.length, 22);
    local.writeUInt16LE(filenameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    filenameBuf.copy(local, 30);
    contentBuf.copy(local, 30 + filenameBuf.length);
    localHeaders.push(local);

    const central = Buffer.alloc(46 + filenameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contentBuf.length, 20);
    central.writeUInt32LE(contentBuf.length, 24);
    central.writeUInt16LE(filenameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    filenameBuf.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0);
  endOfCentral.writeUInt16LE(0, 4);
  endOfCentral.writeUInt16LE(0, 6);
  endOfCentral.writeUInt16LE(files.length, 8);
  endOfCentral.writeUInt16LE(files.length, 10);
  endOfCentral.writeUInt32LE(centralDirSize, 12);
  endOfCentral.writeUInt32LE(offset, 16);
  endOfCentral.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, endOfCentral]);
}

describe('ServersFilesService (RF-ARQ-17, L-04)', () => {
  let service: ServersFilesService;
  let mockServerRepo: any;
  let mockConfigService: any;
  let tempStorageRoot: string;
  let sampleServer: Server;

  beforeEach(async () => {
    tempStorageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'servers-storage-'));

    sampleServer = {
      id: 'srv-1234',
      name: 'Test Server',
      subdomain: 'test-mc',
      state: 'STOPPED',
    } as Server;

    mockServerRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id === sampleServer.id) return sampleServer;
        return null;
      }),
    };

    mockConfigService = {
      storage: {
        serversDataRoot: tempStorageRoot,
      },
    };

    service = new ServersFilesService(mockServerRepo, mockConfigService);
  });

  afterEach(async () => {
    await fs.promises.rm(tempStorageRoot, { recursive: true, force: true });
  });

  describe('writeFile and readFile', () => {
    it('should write and read files atomically inside server /data', async () => {
      await service.writeFile(sampleServer.id, 'server.properties', 'server-port=25565');

      const res = await service.readFile(sampleServer.id, 'server.properties');
      expect(res.content).toBe('server-port=25565');
    });

    it('should reject path traversal in readFile with ForbiddenException', async () => {
      await expect(
        service.readFile(sampleServer.id, '../../etc/passwd'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject path traversal in writeFile with ForbiddenException', async () => {
      await expect(
        service.writeFile(sampleServer.id, '../../evil.sh', '#!/bin/sh'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listFiles', () => {
    it('should list files and subdirectories', async () => {
      await service.writeFile(sampleServer.id, 'config/paper.yml', 'settings: {}');
      await service.writeFile(sampleServer.id, 'eula.txt', 'eula=true');

      const res = await service.listFiles(sampleServer.id, '');
      expect(res.files.length).toBeGreaterThanOrEqual(2);
      expect(res.files.map((f) => f.name)).toContain('config');
      expect(res.files.map((f) => f.name)).toContain('eula.txt');
    });
  });

  describe('deleteFile', () => {
    it('should delete specified file', async () => {
      await service.writeFile(sampleServer.id, 'whitelist.json', '[]');
      await service.deleteFile(sampleServer.id, 'whitelist.json');

      await expect(
        service.readFile(sampleServer.id, 'whitelist.json'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent deleting the root server directory', async () => {
      await expect(service.deleteFile(sampleServer.id, '.')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('uploadWorld (RF-ARQ-17, L-04, Acceptance Criteria)', () => {
    it('should reject upload with HTTP 409 Conflict if server is in READY state', async () => {
      sampleServer.state = 'READY';

      const zipBuf = createMockZip([{ name: 'world/level.dat', content: 'seed=999' }]);

      await expect(
        service.uploadWorld(sampleServer.id, {
          originalname: 'world.zip',
          buffer: zipBuf,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject upload with HTTP 409 Conflict if server is in STARTING state', async () => {
      sampleServer.state = 'STARTING';

      const zipBuf = createMockZip([{ name: 'world/level.dat', content: 'seed=999' }]);

      await expect(
        service.uploadWorld(sampleServer.id, {
          originalname: 'world.zip',
          buffer: zipBuf,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept upload and extract world when server is STOPPED', async () => {
      sampleServer.state = 'STOPPED';

      const zipBuf = createMockZip([
        { name: 'world/level.dat', content: 'seed=999' },
        { name: 'world/session.lock', content: 'lock-test' },
      ]);

      const res = await service.uploadWorld(sampleServer.id, {
        originalname: 'my-world.zip',
        buffer: zipBuf,
      });

      expect(res.message).toBe('Extraction completed successfully');
      expect(res.extractedCount).toBe(2);

      const serverDir = path.join(tempStorageRoot, sampleServer.subdomain);
      const levelDat = await fs.promises.readFile(
        path.join(serverDir, 'world', 'level.dat'),
        'utf-8',
      );
      expect(levelDat).toBe('seed=999');
    });
  });

  describe('RF-STO-09, RF-ARQ-16: Session.lock Protection and Active World Guard', () => {
    it('should strictly prohibit deletion of session.lock with BadRequestException', async () => {
      await expect(
        service.deleteFile(sampleServer.id, 'world/session.lock'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should strictly prohibit manual writing to session.lock with BadRequestException', async () => {
      await expect(
        service.writeFile(sampleServer.id, 'world/session.lock', 'binary-lock-data'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject world file modification when server is READY with ConflictException', async () => {
      sampleServer.state = 'READY';

      await expect(
        service.writeFile(sampleServer.id, 'world/data/raids.dat', 'content'),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.deleteFile(sampleServer.id, 'world/data/raids.dat'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
