import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { KubernetesService } from './k8s.service';
import { MockKubernetesDriver } from './drivers/mock-k8s.driver';
import { serverDataDirectory } from './server-data-volume';

describe('KubernetesService', () => {
  let service: KubernetesService;
  let driver: MockKubernetesDriver;
  let mockConfigService: AppConfigService;
  let server: Server;
  let settings: MinecraftServerSettings;
  let serversDataRoot: string;

  beforeEach(() => {
    driver = new MockKubernetesDriver();
    serversDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-servers-'));
    mockConfigService = {
      storage: { serversDataRoot },
      kubernetes: {
        namespace: 'minekubernetes',
        nodeAffinityKey: 'kubernetes.io/hostname',
      },
      registry: {
        jvmRunnerImage: 'eclipse-temurin:{java}-jre-jammy',
      },
    } as any;

    service = new KubernetesService(driver, mockConfigService);

    server = {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Paper Lobby',
      subdomain: 'lobby',
      game_type: 'minecraft',
      routing_model: 'sni-shared-port',
      server_type: 'PAPER',
      game_version: '1.20.4',
      allocated_memory_mb: 4096,
      allocated_port: null,
      state: 'STOPPED',
    } as Server;

    settings = {
      motd: 'Lobby server',
      max_players: 50,
    } as MinecraftServerSettings;
  });

  afterEach(() => fs.rmSync(serversDataRoot, { recursive: true, force: true }));

  // local-path faz chmod 700 no diretório do PVC ao provisionar: o control plane só continua entrando
  // nele se já for o dono, ou seja, se criou o diretório antes de o PVC existir.
  it('cria o diretório do servidor antes do PVC', async () => {
    const serverDir = path.join(serversDataRoot, serverDataDirectory(server.subdomain));
    let existedWhenPvcWasCreated = false;
    const createPvc = driver.createPersistentVolumeClaim.bind(driver);
    driver.createPersistentVolumeClaim = async (manifest) => {
      existedWhenPvcWasCreated = fs.existsSync(serverDir);
      return createPvc(manifest);
    };

    await service.provisionServer(server, settings);

    expect(existedWhenPvcWasCreated).toBe(true);
  });

  it('should provision PVC, Service, and Deployment', async () => {
    await service.provisionServer(server, settings);

    expect(driver.pvcs.has('minekubernetes/data-lobby')).toBe(true);
    expect(driver.services.has('minekubernetes/mc-lobby')).toBe(true);
    expect(driver.deployments.has('minekubernetes/mc-lobby')).toBe(true);
  });

  it('should start server by scaling deployment to 1', async () => {
    await service.provisionServer(server, settings);
    await service.startServer(server);

    const dep = await driver.getDeployment('mc-lobby', 'minekubernetes');
    expect(dep?.replicas).toBe(1);
  });

  it('should start a server created before a manifest change on the new manifest (#155)', async () => {
    await service.provisionServer(server, settings);
    const before = driver.deployments.get('minekubernetes/mc-lobby').spec.template.spec;
    expect(before.containers[0].image).toBe('eclipse-temurin:21-jre-jammy');
    expect(before.initContainers).toBeUndefined();

    server.java_version = 25;
    server.server_jar_url = 'https://fill-data.papermc.io/v1/objects/abc/paper-26.2-129.jar';
    server.server_jar_checksum = 'sha256:abc';
    server.state = 'STARTING';
    await service.startServer(server);

    const after = driver.deployments.get('minekubernetes/mc-lobby');
    expect(after.spec.template.spec.containers[0].image).toBe('eclipse-temurin:25-jre-jammy');
    expect(after.spec.template.spec.initContainers[0].env).toContainEqual({
      name: 'SERVER_JAR_URL',
      value: 'https://fill-data.papermc.io/v1/objects/abc/paper-26.2-129.jar',
    });
    expect(after.spec.replicas).toBe(1);
  });

  it('should stop server by scaling deployment to 0', async () => {
    await service.provisionServer(server, settings);
    await service.startServer(server);
    await service.stopServer(server);

    const dep = await driver.getDeployment('mc-lobby', 'minekubernetes');
    expect(dep?.replicas).toBe(0);
  });

  it('applyDeployment rewrites heap and container limit and keeps replicas in line with the state', async () => {
    await service.provisionServer(server, settings);
    server.allocated_memory_mb = 6144;
    server.state = 'STARTING';

    await service.applyDeployment(server, settings);

    const container =
      driver.deployments.get('minekubernetes/mc-lobby').spec.template.spec.containers[0];
    expect(container.args[0]).toContain('-Xmx6144M');
    expect(container.resources.limits.memory).toBe(`${6144 + 1536}Mi`);
    expect((await driver.getDeployment('mc-lobby', 'minekubernetes'))?.replicas).toBe(1);
  });

  it('should deprovision server by deleting deployment, service, and PVC', async () => {
    await service.provisionServer(server, settings);
    expect(driver.deployments.size).toBe(1);

    await service.deprovisionServer(server);
    expect(driver.deployments.has('minekubernetes/mc-lobby')).toBe(false);
    expect(driver.services.has('minekubernetes/mc-lobby')).toBe(false);
    expect(driver.pvcs.has('minekubernetes/data-lobby')).toBe(false);
  });

  describe('RF-ARQ-08: Graceful Shutdown (save-all flush -> stop -> scale to 0)', () => {
    let mockConsoleDriver: any;

    beforeEach(() => {
      mockConsoleDriver = {
        gracefulShutdown: jest.fn().mockResolvedValue(undefined),
      };
      service = new KubernetesService(driver, mockConfigService, mockConsoleDriver);
    });

    it('should invoke gracefulShutdown via consoleDriver when stopping a READY Minecraft server', async () => {
      server.state = 'READY';
      server.game_type = 'MINECRAFT';

      await service.provisionServer(server, settings);
      await service.startServer(server);
      await service.stopServer(server);

      expect(mockConsoleDriver.gracefulShutdown).toHaveBeenCalledWith(server);
      const dep = await driver.getDeployment('mc-lobby', 'minekubernetes');
      expect(dep?.replicas).toBe(0);
    });

    it('should proceed with scale to 0 even if gracefulShutdown throws or times out', async () => {
      server.state = 'READY';
      mockConsoleDriver.gracefulShutdown.mockRejectedValue(new Error('RCON connection timeout'));

      await service.provisionServer(server, settings);
      await service.startServer(server);
      await service.stopServer(server);

      expect(mockConsoleDriver.gracefulShutdown).toHaveBeenCalledWith(server);
      const dep = await driver.getDeployment('mc-lobby', 'minekubernetes');
      expect(dep?.replicas).toBe(0);
    });
  });
});
