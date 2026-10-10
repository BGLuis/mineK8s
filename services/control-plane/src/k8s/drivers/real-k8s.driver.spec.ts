import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';

import { RealKubernetesDriver } from './real-k8s.driver';

interface CapturedRequest {
  method?: string;
  url?: string;
  contentType?: string;
  body: string;
}

describe('RealKubernetesDriver contra um API server HTTP local', () => {
  let server: http.Server;
  let tempDir: string;
  let requests: CapturedRequest[];
  let responses: Record<string, { status?: number; body: unknown }>;
  let driver: RealKubernetesDriver;

  beforeEach(async () => {
    requests = [];
    responses = {};
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          contentType: req.headers['content-type'],
          body,
        });
        const custom = responses[(req.url ?? '').split('?')[0]];
        res.statusCode = custom?.status ?? 200;
        if (typeof custom?.body === 'string') {
          res.setHeader('Content-Type', 'text/plain');
          res.end(custom.body);
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(custom?.body ?? { apiVersion: 'autoscaling/v1', kind: 'Scale', spec: {} }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubeconfig-'));
    const kubeconfig = path.join(tempDir, 'config');
    fs.writeFileSync(
      kubeconfig,
      [
        'apiVersion: v1',
        'kind: Config',
        'clusters: [{ name: local, cluster: { server: "http://127.0.0.1:' +
          port +
          '", insecure-skip-tls-verify: true } }]',
        'users: [{ name: local, user: { token: test } }]',
        'contexts: [{ name: local, context: { cluster: local, user: local } }]',
        'current-context: local',
      ].join('\n'),
    );
    driver = new RealKubernetesDriver({
      kubernetes: { inCluster: false, kubeconfig, namespace: 'minekubernetes' },
    } as any);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // O API server recusa um objeto enviado como JSON Patch ("error decoding patch"), e o servidor nunca liga.
  it('escala o Deployment com um merge patch', async () => {
    await driver.scaleDeployment('mc-lobby', 1);

    expect(requests).toEqual([
      {
        method: 'PATCH',
        url: '/apis/apps/v1/namespaces/minekubernetes/deployments/mc-lobby/scale',
        contentType: 'application/merge-patch+json',
        body: JSON.stringify({ spec: { replicas: 1 } }),
      },
    ]);
  });

  describe('recurso que já não existe (404 do API server)', () => {
    const notFound = (path: string) => {
      responses[path] = {
        status: 404,
        body: {
          kind: 'Status',
          apiVersion: 'v1',
          status: 'Failure',
          reason: 'NotFound',
          code: 404,
        },
      };
    };
    const ns = '/namespaces/minekubernetes';

    it.each([
      [
        'Deployment',
        `/apis/apps/v1${ns}/deployments/mc-lobby`,
        () => driver.deleteDeployment('mc-lobby'),
      ],
      ['Service', `/api/v1${ns}/services/mc-lobby`, () => driver.deleteService('mc-lobby')],
      [
        'PersistentVolumeClaim',
        `/api/v1${ns}/persistentvolumeclaims/data-lobby`,
        () => driver.deletePersistentVolumeClaim('data-lobby'),
      ],
      ['Job', `/apis/batch/v1${ns}/jobs/install-lobby`, () => driver.deleteJob('install-lobby')],
    ])('apagar o %s ausente não é erro', async (_kind, path, remove) => {
      notFound(path);

      await expect(remove()).resolves.toBeUndefined();
    });

    it.each([
      [
        'Deployment',
        `/apis/apps/v1${ns}/deployments/mc-lobby`,
        () => driver.getDeployment('mc-lobby'),
      ],
      ['Job', `/apis/batch/v1${ns}/jobs/install-lobby`, () => driver.getJob('install-lobby')],
    ])('ler o %s ausente devolve null', async (_kind, path, read) => {
      notFound(path);

      await expect(read()).resolves.toBeNull();
    });

    it('um erro que não é 404 continua subindo', async () => {
      responses[`/apis/apps/v1${ns}/deployments/mc-lobby`] = {
        status: 500,
        body: { kind: 'Status', status: 'Failure', code: 500 },
      };

      await expect(driver.deleteDeployment('mc-lobby')).rejects.toBeDefined();
    });
  });

  describe('getPodStats', () => {
    const podsPath = '/api/v1/namespaces/minekubernetes/pods';
    const metricsPath = '/apis/metrics.k8s.io/v1beta1/namespaces/minekubernetes/pods';
    const runningPod = {
      metadata: { name: 'mc-lobby-abc' },
      status: { phase: 'Running', startTime: '2026-10-09T10:00:00Z' },
      spec: { containers: [{ resources: { limits: { memory: '5632Mi' } } }] },
    };

    it('combines the running pod with its memory from the Metrics API', async () => {
      responses[podsPath] = { body: { items: [runningPod] } };
      responses[metricsPath] = {
        body: {
          items: [
            { metadata: { name: 'other-pod' }, containers: [{ usage: { memory: '1Gi' } }] },
            {
              metadata: { name: 'mc-lobby-abc' },
              containers: [{ usage: { memory: '3145728Ki' } }],
            },
          ],
        },
      };

      const stats = await driver.getPodStats('mc-lobby');

      expect(stats).toEqual({
        startedAt: new Date('2026-10-09T10:00:00Z'),
        memoryUsedBytes: 3 * 1024 ** 3,
        memoryLimitBytes: 5632 * 1024 ** 2,
      });
      expect(requests[0].url).toContain('labelSelector=app.kubernetes.io%2Fname%3Dmc-lobby');
    });

    it('still reports the pod when the cluster has no metrics server', async () => {
      responses[podsPath] = { body: { items: [runningPod] } };
      responses[metricsPath] = { status: 404, body: { message: 'not found' } };

      const stats = await driver.getPodStats('mc-lobby');

      expect(stats?.memoryUsedBytes).toBeNull();
      expect(stats?.memoryLimitBytes).toBe(5632 * 1024 ** 2);
    });

    it('returns null while the pod is not running', async () => {
      responses[podsPath] = {
        body: { items: [{ ...runningPod, status: { phase: 'Pending' } }] },
      };

      expect(await driver.getPodStats('mc-lobby')).toBeNull();
    });
  });
  describe('streamPodLogs', () => {
    const podsPath = '/api/v1/namespaces/minekubernetes/pods';
    const logPath = `${podsPath}/mc-lobby-abc/log`;
    const readAll = async (stream: NodeJS.ReadableStream) => {
      let text = '';
      for await (const chunk of stream) text += chunk;
      return text;
    };

    it('follows the log of the runner container in the running pod', async () => {
      responses[podsPath] = {
        body: {
          items: [{ metadata: { name: 'mc-lobby-abc' }, status: { phase: 'Running' } }],
        },
      };
      responses[logPath] = { body: '[10:00:00 INFO]: Done\n[10:00:05 INFO]: Steve joined\n' };

      const stream = await driver.streamPodLogs('mc-lobby');

      expect(await readAll(stream as NodeJS.ReadableStream)).toBe(
        '[10:00:00 INFO]: Done\n[10:00:05 INFO]: Steve joined\n',
      );
      const logRequest = requests.find((r) => r.url?.startsWith(logPath));
      expect(logRequest?.url).toContain('follow=true');
      expect(logRequest?.url).toContain('tailLines=500');
      expect(logRequest?.url).toContain('container=runner');
    });

    it('returns null while the pod is not running', async () => {
      responses[podsPath] = {
        body: { items: [{ metadata: { name: 'mc-lobby-abc' }, status: { phase: 'Pending' } }] },
      };

      expect(await driver.streamPodLogs('mc-lobby')).toBeNull();
    });
  });
});
