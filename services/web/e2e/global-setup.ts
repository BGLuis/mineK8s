import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { startRcon, startSlp } from './fakes/minecraft';
import { startMojangMeta } from './fakes/mojang';
import { startCloudApi, startLocalApi } from './fakes/tailscale';
import {
  BOOTSTRAP_TOKEN,
  CLOUD_API_PORT,
  CONTROL_PLANE_PORT,
  CONTROL_PLANE_URL,
  GRPC_PORT,
  MOJANG_META_PORT,
  POSTGRES_PORT,
  RCON_PORT,
  SLP_PORT,
  SPA_URL,
} from './env';

const CONTROL_PLANE_DIR = path.resolve(__dirname, '../../control-plane');
const COMPOSE = [
  'compose',
  '-p',
  'minek8s-e2e',
  '-f',
  path.join(__dirname, 'docker-compose.e2e.yml'),
];
const LOG_FILE = path.resolve(__dirname, '../test-results/control-plane.log');

function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () =>
      reject(new Error(`Port ${port} is in use; the e2e suite needs it (see e2e/env.ts).`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

async function waitForHealth(child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Control plane exited with code ${child.exitCode}; see ${LOG_FILE}`);
    }
    try {
      if ((await fetch(`${CONTROL_PLANE_URL}/healthz`)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Control plane did not become healthy in ${timeoutMs} ms; see ${LOG_FILE}`);
}

/**
 * Brings up the real control plane (built from services/control-plane) on Postgres, with the mock
 * Kubernetes driver and fakes for everything outside this machine: tailscaled, the Tailscale Cloud
 * API, Mojang's version metadata and the game server's RCON/SLP ports. The returned function is the global teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  for (const port of [
    CONTROL_PLANE_PORT,
    GRPC_PORT,
    POSTGRES_PORT,
    CLOUD_API_PORT,
    MOJANG_META_PORT,
    RCON_PORT,
    SLP_PORT,
  ]) {
    await assertPortFree(port);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minek8s-e2e-'));
  const socketPath = path.join(workDir, 'tailscaled.sock');
  const fakes = await Promise.all([
    startLocalApi(socketPath),
    startCloudApi(CLOUD_API_PORT),
    startMojangMeta(MOJANG_META_PORT),
    startRcon(RCON_PORT),
    startSlp(SLP_PORT),
  ]);

  execFileSync('docker', [...COMPOSE, 'up', '-d', '--wait'], {
    stdio: 'inherit',
    env: { ...process.env, E2E_POSTGRES_PORT: String(POSTGRES_PORT) },
  });
  execFileSync('npm', ['run', 'build'], { cwd: CONTROL_PLANE_DIR, stdio: 'inherit' });

  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const log = fs.openSync(LOG_FILE, 'w');
  const controlPlane = spawn('node', ['dist/main.js'], {
    cwd: CONTROL_PLANE_DIR,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(CONTROL_PLANE_PORT),
      GRPC_HOST: '127.0.0.1',
      GRPC_PORT: String(GRPC_PORT),
      ALLOWED_ORIGINS: SPA_URL,
      PUBLIC_BASE_URL: SPA_URL,
      ENABLE_SWAGGER: 'false',
      DB_HOST: '127.0.0.1',
      DB_PORT: String(POSTGRES_PORT),
      DB_USER: 'minek8s',
      DB_PASSWORD: 'minek8s_e2e',
      DB_NAME: 'minekubernetes',
      JWT_SECRET: 'e2e-jwt-secret-with-at-least-32-characters',
      INITIAL_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
      // USE_MOCK_K8S picks the driver; KUBERNETES_USE_MOCK_DRIVER points RCON and probes at 127.0.0.1.
      USE_MOCK_K8S: 'true',
      KUBERNETES_USE_MOCK_DRIVER: 'true',
      RECONCILIATION_INTERVAL_MS: '1000',
      HEALTH_BOT_ENABLED: 'false',
      TAILSCALE_SOCKET_PATH: socketPath,
      TAILSCALE_API_URL: `http://127.0.0.1:${CLOUD_API_PORT}`,
      TAILSCALE_API_KEY: 'tskey-api-e2e',
      MOJANG_VERSION_MANIFEST_URL: `http://127.0.0.1:${MOJANG_META_PORT}/mc/game/version_manifest_v2.json`,
      SERVERS_DATA_ROOT: path.join(workDir, 'servers'),
      BACKUPS_PATH: path.join(workDir, 'backups'),
      SHARED_CACHE_PATH: path.join(workDir, 'cache'),
      WEB_DIST_DIR: path.join(workDir, 'no-spa-build'),
    },
  });

  const teardown = async () => {
    controlPlane.kill('SIGTERM');
    await Promise.all(fakes.map((server) => new Promise((resolve) => server.close(resolve))));
    execFileSync('docker', [...COMPOSE, 'down', '-v'], { stdio: 'inherit' });
    fs.rmSync(workDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(controlPlane, 60_000);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
