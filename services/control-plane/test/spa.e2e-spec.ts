import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Controller, Get } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';

import { AppController } from '../src/app.controller';
import { serveSpa, SPA_HELMET_OPTIONS } from '../src/common/spa-static';
import { AppConfigService } from '../src/config/app-config.service';

@Controller('api/ping')
class PingController {
  @Get()
  ping() {
    return { pong: true };
  }
}

/** #94 over real HTTP: the SPA build and the API share one Nest app, wired the way main.ts wires them. */
describe('SPA served by the control plane (#94)', () => {
  const INDEX =
    '<!doctype html><html><body><mc-root></mc-root><script src="main-ABC.js" type="module"></script></body></html>';
  let distDir: string;
  let app: NestExpressApplication;

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-e2e-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), INDEX);
    fs.writeFileSync(path.join(distDir, 'main-ABC.js'), 'console.log("spa")');

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController, PingController],
      providers: [{ provide: AppConfigService, useValue: { nodeEnv: 'test' } }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(helmet(SPA_HELMET_OPTIONS));
    expect(serveSpa(app, distDir)).toBe(true);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('answers an invite deep link with index.html, under a CSP that allows no inline or foreign script', async () => {
    const res = await request(app.getHttpServer()).get('/join?token=abc123');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toBe(INDEX);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("font-src 'self';");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('serves the build files as they are', async () => {
    const res = await request(app.getHttpServer()).get('/main-ABC.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log("spa")');
  });

  it('answers a missing file with 404 instead of the page', async () => {
    const res = await request(app.getHttpServer()).get('/main-OLD.js');

    expect(res.status).toBe(404);
  });

  it('keeps the API in JSON, including the 404 of an unknown route', async () => {
    const ping = await request(app.getHttpServer()).get('/api/ping');
    const missing = await request(app.getHttpServer()).get('/api/does-not-exist');
    const health = await request(app.getHttpServer()).get('/healthz');

    expect(ping.body).toEqual({ pong: true });
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toMatch(/application\/json/);
    expect(health.body).toMatchObject({ status: 'ok' });
  });

  it('does not answer non-GET requests with the page', async () => {
    const res = await request(app.getHttpServer()).post('/join').send({});

    expect(res.status).toBe(404);
    expect(res.text).not.toBe(INDEX);
  });
});
