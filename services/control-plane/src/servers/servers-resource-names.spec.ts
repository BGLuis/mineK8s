import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Server } from '@database/entities/server.entity';
import { MockKubernetesDriver } from '@k8s/drivers/mock-k8s.driver';
import { KubernetesService } from '@k8s/k8s.service';

import { ServersService } from './servers.service';
import { ServerType } from './dto/create-server.dto';

/**
 * ServersService and KubernetesService wired to a fake cluster. Changing the subdomain must not strand the
 * resources created at provisioning time: the server is later found, stopped and deleted under the same names.
 */
describe('Kubernetes resource names across a subdomain change', () => {
  const namespace = 'minekubernetes';
  let serversDb: Map<string, Server>;
  let driver: MockKubernetesDriver;
  let service: ServersService;
  let serversDataRoot: string;
  let nextId: number;

  const clusterNames = () =>
    [...driver.pvcs.keys(), ...driver.services.keys(), ...driver.deployments.keys()].sort();

  const createServer = (subdomain: string) =>
    service.create({
      name: subdomain,
      subdomain,
      server_type: ServerType.PAPER,
      game_version: '1.20.4',
    });

  beforeEach(() => {
    nextId = 1;
    serversDb = new Map();
    driver = new MockKubernetesDriver();
    serversDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'servers-names-'));

    const serverRepo = {
      create: jest.fn((dto) => ({ id: `srv-${nextId++}`, ...dto })),
      save: jest.fn(async (entity) => {
        serversDb.set(entity.id, entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        for (const server of serversDb.values()) {
          if (where.id && server.id === where.id) return server;
          if (where.subdomain && server.subdomain === where.subdomain) return server;
          if (where.resource_name && server.resource_name === where.resource_name) return server;
        }
        return null;
      }),
      remove: jest.fn(async (entity) => {
        serversDb.delete(entity.id);
        return entity;
      }),
    };
    const settingsRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
    };
    const k8sService = new KubernetesService(driver, {
      storage: { serversDataRoot },
      kubernetes: { namespace, nodeAffinityKey: 'kubernetes.io/hostname' },
      registry: { jvmRunnerImage: 'eclipse-temurin:{java}-jre-jammy' },
    } as any);
    const runtimeResolver = {
      resolve: jest.fn(async () => ({
        java_version: 21,
        server_jar_url: 'https://example.invalid/paper.jar',
        server_jar_checksum: 'sha256:abc',
        server_build: '1',
        server_build_channel: 'STABLE',
      })),
    };

    service = new ServersService(
      serverRepo as any,
      settingsRepo as any,
      {} as any,
      k8sService,
      {} as any,
      {} as any,
      runtimeResolver as any,
    );
  });

  afterEach(() => fs.rmSync(serversDataRoot, { recursive: true, force: true }));

  it('deletes a server after a domain change by removing exactly what it created', async () => {
    const { id } = await createServer('hub');
    const created = clusterNames();
    expect(created).toEqual([
      'minekubernetes/data-hub',
      'minekubernetes/mc-hub',
      'minekubernetes/mc-hub',
    ]);

    await service.updateDomain(id, 'lobby');
    expect(clusterNames()).toEqual(created);

    await service.delete(id);

    expect(clusterNames()).toEqual([]);
    expect(serversDb.size).toBe(0);
  });

  it('gives a server created on a subdomain left behind by a rename its own resources', async () => {
    const first = await createServer('hub');
    await service.updateDomain(first.id, 'lobby');

    const second = await createServer('hub');
    expect(serversDb.get(second.id)?.resource_name).not.toBe('hub');
    expect(clusterNames()).toHaveLength(6);

    await service.delete(second.id);
    expect(clusterNames()).toEqual([
      'minekubernetes/data-hub',
      'minekubernetes/mc-hub',
      'minekubernetes/mc-hub',
    ]);

    await service.delete(first.id);
    expect(clusterNames()).toEqual([]);
  });
});
