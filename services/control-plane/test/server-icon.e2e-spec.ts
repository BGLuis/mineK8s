import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as zlib from 'zlib';

import { ServersBackupService } from '../src/servers/servers-backup.service';
import { ServersController } from '../src/servers/servers.controller';
import { ServersFilesService } from '../src/servers/servers-files.service';
import { ServerIconService } from '../src/servers/server-icon.service';
import { ServersService } from '../src/servers/servers.service';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The server list icon over real HTTP: multipart upload, validation and download through the controller. */
describe('Server icon endpoints', () => {
  let root: string;
  let app: INestApplication;
  const publishRoute = jest.fn(async () => undefined);

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-e2e-'));
    const repo = {
      findOne: async ({ where }: any) =>
        where.id === 'srv-1' ? { id: 'srv-1', resource_name: 'sekiro' } : null,
    };
    const icons = new ServerIconService(repo as any, { storage: { serversDataRoot: root } } as any);
    // The real ServersService methods, without the dependencies the icon does not use.
    const serversService = Object.create(ServersService.prototype);
    Object.assign(serversService, {
      iconService: icons,
      gatewayIpcService: { publishRoute },
      logger: { warn: jest.fn() },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [ServersController],
      providers: [
        { provide: ServersService, useValue: serversService },
        { provide: ServersFilesService, useValue: {} },
        { provide: ServersBackupService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => publishRoute.mockClear());

  const upload = (image: Buffer, id = 'srv-1') =>
    request(app.getHttpServer())
      .put(`/api/servers/${id}/icon`)
      .attach('file', image, { filename: 'icon.png', contentType: 'image/png' });

  it('saves a 64x64 PNG and serves it back as image/png', async () => {
    const image = png(64, 64);

    const saved = await upload(image);
    expect(saved.status).toBe(200);
    expect(publishRoute).toHaveBeenCalledWith('srv-1');

    const served = await request(app.getHttpServer())
      .get('/api/servers/srv-1/icon')
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () => done(null, Buffer.concat(parts)));
      });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect((served.body as Buffer).equals(image)).toBe(true);
  });

  it('refuses an image that is not 64x64, with the reason', async () => {
    const res = await upload(png(128, 128));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/64x64 pixels \(got 128x128\)/);
    expect(publishRoute).not.toHaveBeenCalled();
  });

  it('refuses a request without a file', async () => {
    const res = await request(app.getHttpServer()).put('/api/servers/srv-1/icon');

    expect(res.status).toBe(400);
  });

  it('refuses a file far above the cap before reading it all', async () => {
    const res = await upload(Buffer.concat([png(64, 64), Buffer.alloc(300 * 1024)]));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('answers 404 for a missing server and for a server without an icon', async () => {
    expect((await upload(png(64, 64), 'nope')).status).toBe(404);

    await request(app.getHttpServer()).delete('/api/servers/srv-1/icon').expect(200);
    await request(app.getHttpServer()).get('/api/servers/srv-1/icon').expect(404);
  });
});
