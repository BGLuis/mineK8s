import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ArchiveExtractor } from './archive-extractor';

function createZipBuffer(
  files: Array<{ name: string; content?: string; isSymlink?: boolean }>,
): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf-8');
    const contentBuf = Buffer.from(file.content || '', 'utf-8');
    const crc = (zlib as any).crc32(contentBuf);

    // Local file header
    const local = Buffer.alloc(30 + filenameBuf.length + contentBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // general purpose bit flag
    local.writeUInt16LE(0, 8); // compression method (STORE)
    local.writeUInt16LE(0, 10); // file time
    local.writeUInt16LE(0, 12); // file date
    local.writeUInt32LE(crc, 14); // crc32
    local.writeUInt32LE(contentBuf.length, 18); // compressed size
    local.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    local.writeUInt16LE(filenameBuf.length, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length
    filenameBuf.copy(local, 30);
    contentBuf.copy(local, 30 + filenameBuf.length);

    localHeaders.push(local);

    // Central directory file header
    const externalAttr = file.isSymlink
      ? ((0o120777 << 16) >>> 0)
      : ((0o100644 << 16) >>> 0);
    const central = Buffer.alloc(46 + filenameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // general purpose bit flag
    central.writeUInt16LE(0, 10); // compression method (STORE)
    central.writeUInt16LE(0, 12); // file time
    central.writeUInt16LE(0, 14); // file date
    central.writeUInt32LE(crc, 16); // crc32
    central.writeUInt32LE(contentBuf.length, 20); // compressed size
    central.writeUInt32LE(contentBuf.length, 24); // uncompressed size
    central.writeUInt16LE(filenameBuf.length, 28); // file name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(externalAttr, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    filenameBuf.copy(central, 46);

    centralHeaders.push(central);
    offset += local.length;
  }

  const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  endOfCentral.writeUInt16LE(0, 4); // disk number
  endOfCentral.writeUInt16LE(0, 6); // disk number with central dir
  endOfCentral.writeUInt16LE(files.length, 8); // total entries on this disk
  endOfCentral.writeUInt16LE(files.length, 10); // total entries
  endOfCentral.writeUInt32LE(centralDirSize, 12); // size of central directory
  endOfCentral.writeUInt32LE(offset, 16); // offset of central directory
  endOfCentral.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endOfCentral]);
}

describe('ArchiveExtractor (Zip-Slip & Symlink Mitigations - L-04)', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'archive-extract-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(targetDir, { recursive: true, force: true });
  });

  it('should extract valid zip entries into targetDir', async () => {
    const zipBuf = createZipBuffer([
      { name: 'world/level.dat', content: 'seed=12345' },
      { name: 'server.properties', content: 'difficulty=hard' },
    ]);

    const extracted = await ArchiveExtractor.extractZip(zipBuf, targetDir);
    expect(extracted.length).toBe(2);

    const levelDat = await fs.promises.readFile(
      path.join(targetDir, 'world', 'level.dat'),
      'utf-8',
    );
    expect(levelDat).toBe('seed=12345');
  });

  it('should strictly reject Zip-Slip attempts with ".." path traversal (L-04)', async () => {
    const maliciousZip = createZipBuffer([
      { name: '../../etc/passwd_evil', content: 'malicious' },
    ]);

    await expect(ArchiveExtractor.extractZip(maliciousZip, targetDir)).rejects.toThrow(
      ForbiddenException,
    );

    // Ensure the file was not written outside targetDir
    expect(fs.existsSync(path.join(targetDir, '../../etc/passwd_evil'))).toBe(false);
  });

  it('should strictly reject symlink entries inside ZIP archive (L-04)', async () => {
    const symlinkZip = createZipBuffer([
      { name: 'world/evil_link', content: '/etc/shadow', isSymlink: true },
    ]);

    await expect(ArchiveExtractor.extractZip(symlinkZip, targetDir)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
