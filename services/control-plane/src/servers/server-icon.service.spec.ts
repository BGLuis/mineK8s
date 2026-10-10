import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import { serverDataDirectory } from '@k8s/server-data-volume';
import {
  MAX_SERVER_ICON_BYTES,
  SERVER_ICON_FILE,
  ServerIconService,
  assertValidServerIcon,
} from './server-icon.service';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid PNG of the given size (solid colour), built without an image library. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('assertValidServerIcon', () => {
  it('accepts a 64x64 PNG', () => {
    expect(() => assertValidServerIcon(png(64, 64))).not.toThrow();
  });

  it.each([
    ['nothing', undefined, /No image/],
    ['an empty file', Buffer.alloc(0), /No image/],
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]), /PNG/],
    ['text', Buffer.from('not an image at all, just some text that is long enough'), /PNG/],
    ['a 32x32 PNG', png(32, 32), /64x64 pixels \(got 32x32\)/],
    ['a 64x128 PNG', png(64, 128), /64x64 pixels \(got 64x128\)/],
  ])('rejects %s', (_name, buffer, message) => {
    expect(() => assertValidServerIcon(buffer)).toThrow(message);
  });

  it('rejects an image above the size cap, even if it is a 64x64 PNG', () => {
    const padded = Buffer.concat([png(64, 64), Buffer.alloc(MAX_SERVER_ICON_BYTES)]);
    expect(() => assertValidServerIcon(padded)).toThrow(/at most/);
  });
});

describe('ServerIconService', () => {
  let root: string;
  let service: ServerIconService;
  const server = { id: 'srv-1', resource_name: 'sekiro' };
  const iconFile = () => path.join(root, serverDataDirectory('sekiro'), SERVER_ICON_FILE);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-icon-'));
    const repo = {
      findOne: jest.fn(async ({ where }: any) => (where.id === 'srv-1' ? server : null)),
    };
    service = new ServerIconService(repo as any, { storage: { serversDataRoot: root } } as any);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('writes the icon where the Minecraft server reads it, named after resource_name', async () => {
    const image = png(64, 64);

    await service.set('srv-1', image);

    expect(fs.readFileSync(iconFile()).equals(image)).toBe(true);
    expect(fs.readdirSync(path.dirname(iconFile()))).toEqual([SERVER_ICON_FILE]);
  });

  it('does not write anything for an invalid image', async () => {
    await expect(service.set('srv-1', png(10, 10))).rejects.toThrow(/64x64/);

    expect(fs.existsSync(iconFile())).toBe(false);
  });

  it('replaces the previous icon', async () => {
    await service.set('srv-1', png(64, 64));
    const second = Buffer.concat([png(64, 64)]);
    second[second.length - 20] ^= 0xff; // a different file, still a 64x64 PNG header

    await service.set('srv-1', second);

    expect(fs.readFileSync(iconFile()).equals(second)).toBe(true);
  });

  it('reads the icon back, and answers 404 when there is none', async () => {
    await expect(service.get('srv-1')).rejects.toThrow(/no icon/);

    const image = png(64, 64);
    await service.set('srv-1', image);

    expect((await service.get('srv-1')).equals(image)).toBe(true);
  });

  it('removes the icon, and removing it twice is not an error', async () => {
    await service.set('srv-1', png(64, 64));

    await service.remove('srv-1');
    await service.remove('srv-1');

    expect(fs.existsSync(iconFile())).toBe(false);
  });

  it('gives the gateway the icon as a data URI, or null without one', async () => {
    expect(await service.dataUri(server as any)).toBeNull();

    const image = png(64, 64);
    await service.set('srv-1', image);

    expect(await service.dataUri(server as any)).toBe(
      `data:image/png;base64,${image.toString('base64')}`,
    );
  });

  it('answers 404 for a server that does not exist', async () => {
    await expect(service.set('nope', png(64, 64))).rejects.toThrow(/not found/);
    await expect(service.get('nope')).rejects.toThrow(/not found/);
    await expect(service.remove('nope')).rejects.toThrow(/not found/);
  });
});
