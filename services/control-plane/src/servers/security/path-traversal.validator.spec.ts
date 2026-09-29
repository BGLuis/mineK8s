import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { resolveSafePath } from './path-traversal.validator';

describe('resolveSafePath (L-04)', () => {
  let tempBaseDir: string;

  beforeAll(async () => {
    tempBaseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'safe-path-test-'));
    await fs.promises.mkdir(path.join(tempBaseDir, 'world'), { recursive: true });
    await fs.promises.writeFile(path.join(tempBaseDir, 'server.properties'), 'motd=test');
  });

  afterAll(async () => {
    await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
  });

  it('should accept empty or dot path and return base directory', () => {
    expect(resolveSafePath(tempBaseDir)).toBe(path.resolve(tempBaseDir));
    expect(resolveSafePath(tempBaseDir, '')).toBe(path.resolve(tempBaseDir));
    expect(resolveSafePath(tempBaseDir, '.')).toBe(path.resolve(tempBaseDir));
  });

  it('should resolve valid relative paths inside base directory', () => {
    const res = resolveSafePath(tempBaseDir, 'world/level.dat');
    expect(res).toBe(path.join(tempBaseDir, 'world/level.dat'));
  });

  it('should reject null byte injection with BadRequestException', () => {
    expect(() => resolveSafePath(tempBaseDir, 'world\0/evil.dat')).toThrow(
      BadRequestException,
    );
  });

  it('should reject path traversal with ".." using ForbiddenException', () => {
    expect(() => resolveSafePath(tempBaseDir, '../outside.txt')).toThrow(
      ForbiddenException,
    );
    expect(() => resolveSafePath(tempBaseDir, 'world/../../etc/passwd')).toThrow(
      ForbiddenException,
    );
    expect(() => resolveSafePath(tempBaseDir, '..\\..\\windows\\system32')).toThrow(
      ForbiddenException,
    );
  });

  it('should reject absolute paths pointing outside base directory', () => {
    expect(() => resolveSafePath(tempBaseDir, '/etc/shadow')).toThrow(
      ForbiddenException,
    );
  });

  it('should reject symlinks pointing outside the base directory', async () => {
    const outsideTarget = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-target-'));
    const outsideFile = path.join(outsideTarget, 'secret.txt');
    await fs.promises.writeFile(outsideFile, 'secret');

    const symlinkPath = path.join(tempBaseDir, 'symlink-outside');
    try {
      await fs.promises.symlink(outsideFile, symlinkPath);
    } catch {
      // ignore if symlink creation is not permitted
      return;
    }

    expect(() => resolveSafePath(tempBaseDir, 'symlink-outside')).toThrow(
      ForbiddenException,
    );

    await fs.promises.rm(outsideTarget, { recursive: true, force: true });
  });
});
