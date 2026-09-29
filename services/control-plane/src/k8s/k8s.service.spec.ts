import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { KubernetesService } from './k8s.service';
import { MockKubernetesDriver } from './drivers/mock-k8s.driver';

describe('KubernetesService', () => {
  let service: KubernetesService;
  let driver: MockKubernetesDriver;
  let mockConfigService: AppConfigService;
  let server: Server;
  let settings: MinecraftServerSettings;

  beforeEach(() => {
    driver = new MockKubernetesDriver();
    mockConfigService = {
      kubernetes: {
        namespace: 'minekubernetes',
        nodeAffinityKey: 'kubernetes.io/hostname',
      },
      registry: {
        jvmRunnerImage: 'eclipse-temurin:21-jre-jammy',
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

  it('should stop server by scaling deployment to 0', async () => {
    await service.provisionServer(server, settings);
    await service.startServer(server);
    await service.stopServer(server);

    const dep = await driver.getDeployment('mc-lobby', 'minekubernetes');
    expect(dep?.replicas).toBe(0);
  });

  it('should deprovision server by deleting deployment, service, and PVC', async () => {
    await service.provisionServer(server, settings);
    expect(driver.deployments.size).toBe(1);

    await service.deprovisionServer(server);
    expect(driver.deployments.has('minekubernetes/mc-lobby')).toBe(false);
    expect(driver.services.has('minekubernetes/mc-lobby')).toBe(false);
    expect(driver.pvcs.has('minekubernetes/data-lobby')).toBe(false);
  });
});
