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
  let driver: RealKubernetesDriver;

  beforeEach(async () => {
    requests = [];
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
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ apiVersion: 'autoscaling/v1', kind: 'Scale', spec: {} }));
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
});
