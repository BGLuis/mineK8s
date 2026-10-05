import * as fs from 'node:fs';
import * as path from 'node:path';
import * as stream from 'node:stream';
import * as util from 'node:util';
import * as zlib from 'node:zlib';
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import * as yauzl from 'yauzl';

import { resolveSafePath } from './path-traversal.validator';

const pipeline = util.promisify(stream.pipeline);
const logger = new Logger('ArchiveExtractor');

export class ArchiveExtractor {
  /**
   * Safely extracts a ZIP buffer into targetDir after validating every entry against Zip-Slip and symlink attacks.
   */
  public static async extractZip(zipBuffer: Buffer, targetDir: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          return reject(
            new BadRequestException(
              `Failed to parse ZIP archive: ${err?.message || 'Invalid format'}`,
            ),
          );
        }

        const extractedPaths: string[] = [];

        zipfile.readEntry();

        zipfile.on('entry', async (entry: yauzl.Entry) => {
          try {
            // 1. Check for symlinks in zip externalFileAttributes
            const mode = (entry.externalFileAttributes >> 16) & 0o170000;
            const isSymlink = mode === 0o120000;
            if (isSymlink) {
              zipfile.close();
              return reject(
                new ForbiddenException(
                  `Symlink entry "${entry.fileName}" inside archive is forbidden (L-04)`,
                ),
              );
            }

            // 2. Validate entry path against zip-slip
            let destPath: string;
            try {
              destPath = resolveSafePath(targetDir, entry.fileName);
            } catch (pathErr) {
              zipfile.close();
              return reject(pathErr);
            }

            // 3. If directory, create it
            if (/\/$/.test(entry.fileName)) {
              await fs.promises.mkdir(destPath, { recursive: true });
              extractedPaths.push(destPath);
              zipfile.readEntry();
              return;
            }

            // 4. If file, ensure parent directory exists
            await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

            // 5. Open read stream from zip
            zipfile.openReadStream(entry, async (streamErr, readStream) => {
              if (streamErr || !readStream) {
                zipfile.close();
                return reject(
                  new BadRequestException(
                    `Error reading ZIP entry "${entry.fileName}": ${streamErr?.message}`,
                  ),
                );
              }

              const writeStream = fs.createWriteStream(destPath);
              try {
                await pipeline(readStream, writeStream);
                // Attempt to normalize ownership to UID 1000 if running on linux with privileges
                try {
                  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
                    await fs.promises.chown(destPath, 1000, 1000);
                  }
                } catch {
                  // Ignore non-root permission error in dev/test
                }
                extractedPaths.push(destPath);
                zipfile.readEntry();
              } catch (writeErr) {
                zipfile.close();
                reject(writeErr);
              }
            });
          } catch (entryErr) {
            zipfile.close();
            reject(entryErr);
          }
        });

        zipfile.on('end', () => {
          resolve(extractedPaths);
        });

        zipfile.on('error', (zipErr) => {
          const msg = zipErr?.message || '';
          if (msg.includes('relative path') || msg.includes('..')) {
            reject(new ForbiddenException(`Zip-Slip security violation: ${msg}`));
          } else {
            reject(new BadRequestException(`ZIP processing error: ${msg}`));
          }
        });
      });
    });
  }

  /**
   * Safely extracts a TAR or TAR.GZ buffer into targetDir with strict Zip-Slip and symlink checking.
   */
  public static async extractTar(
    tarBuffer: Buffer,
    targetDir: string,
    isGzip = false,
  ): Promise<string[]> {
    let uncompressed = tarBuffer;
    if (isGzip) {
      try {
        uncompressed = zlib.gunzipSync(tarBuffer);
      } catch (err: any) {
        throw new BadRequestException(`Failed to decompress GZIP: ${err.message}`);
      }
    }

    const tarStream = require('tar-stream');
    const extract = tarStream.extract();
    const extractedPaths: string[] = [];

    return new Promise((resolve, reject) => {
      extract.on('entry', async (header: any, streamEntry: stream.Readable, next: () => void) => {
        try {
          const entryName = header.name;
          const entryType = header.type;

          // Reject symlinks / hardlinks
          if (entryType === 'symlink' || entryType === 'link') {
            extract.destroy();
            return reject(
              new ForbiddenException(
                `Symlink/Link entry "${entryName}" in tar archive is forbidden (L-04)`,
              ),
            );
          }

          let destPath: string;
          try {
            destPath = resolveSafePath(targetDir, entryName);
          } catch (pathErr) {
            extract.destroy();
            return reject(pathErr);
          }

          if (entryType === 'directory' || /\/$/.test(entryName)) {
            await fs.promises.mkdir(destPath, { recursive: true });
            extractedPaths.push(destPath);
            streamEntry.resume();
            next();
            return;
          }

          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
          const writeStream = fs.createWriteStream(destPath);

          await pipeline(streamEntry, writeStream);
          extractedPaths.push(destPath);
          next();
        } catch (err) {
          extract.destroy();
          reject(err);
        }
      });

      extract.on('finish', () => resolve(extractedPaths));
      extract.on('error', (err: any) =>
        reject(new BadRequestException(`TAR error: ${err.message}`)),
      );

      const bufferStream = new stream.PassThrough();
      bufferStream.end(uncompressed);
      bufferStream.pipe(extract);
    });
  }
}
