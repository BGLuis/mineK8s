import * as path from 'node:path';
import * as fs from 'node:fs';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Resolves and validates that a relative path strictly remains within baseDir.
 * Mitigates:
 * - Direct path traversal (.. or \.. or URL-encoded attempts)
 * - Null byte injection (\0)
 * - Absolute path escaping
 * - Symlink traversal pointing outside baseDir
 */
export function resolveSafePath(baseDir: string, relativePath?: string): string {
  const canonicalBase = path.resolve(baseDir);

  if (!relativePath || relativePath.trim() === '' || relativePath === '.') {
    return canonicalBase;
  }

  if (relativePath.includes('\0')) {
    throw new BadRequestException('Null byte injection detected in path');
  }

  // Normalize slashes (handling Windows/POSIX mixed delimiters)
  const normalizedInput = relativePath.replace(/\\/g, '/');

  // Check for explicit '..' segments before resolution
  const segments = normalizedInput.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new ForbiddenException('Path traversal attempt with ".." detected');
    }
  }

  // Resolve target path
  const targetPath = path.resolve(canonicalBase, normalizedInput);

  // Verify target path is within base directory
  const rel = path.relative(canonicalBase, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ForbiddenException('Path traversal outside base directory detected');
  }

  // Symlink verification: verify target and all existing ancestors
  let checkPath = targetPath;
  while (checkPath.length >= canonicalBase.length) {
    if (fs.existsSync(checkPath)) {
      try {
        const real = fs.realpathSync(checkPath);
        const realRel = path.relative(canonicalBase, real);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          throw new ForbiddenException('Symlink points outside safe base directory');
        }
      } catch (err: any) {
        if (err instanceof ForbiddenException) throw err;
      }
    }
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }

  return targetPath;
}
