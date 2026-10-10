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
      resource_name: 'lobby',
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
      difficulty: 'hard',
      gamemode: 'survival',
      hardcore: false,
      pvp: true,
      spawn_protection: 16,
      view_distance: 10,
      simulation_distance: 10,
      rcon_port: 25575,
      rcon_password: 'lobby-rcon-secret',
      enforce_secure_chat: false,
      online_mode: false,
    } as MinecraftServerSettings;
  });

  afterEach(() => fs.rmSync(serversDataRoot, { recursive: true, force: true }));

  // local-path faz chmod 700 no diretório do PVC ao provisionar: o control plane só continua entrando
  // nele se já for o dono, ou seja, se criou o diretório antes de o PVC existir.
  it('cria o diretório do servidor antes do PVC', async () => {
    const serverDir = path.join(serversDataRoot, serverDataDirectory(server.resource_name));
    let existedWhenPvcWasCreated = false;
    const createPvc = driver.createPersistentVolumeClaim.bind(driver);
    driver.createPersistentVolumeClaim = async (manifest) => {
      existedWhenPvcWasCreated = fs.existsSync(serverDir);
      return createPvc(manifest);
    };

    await service.provisionServer(server, settings);

    expect(existedWhenPvcWasCreated).toBe(true);
  });

  // Sem enable-rcon=true o console, o stop gracioso e o backup a quente falham (#153).
  describe('server.properties (#153)', () => {
    const readProps = (srv: Server) =>
      fs.readFileSync(
        path.join(serversDataRoot, serverDataDirectory(srv.resource_name), 'server.properties'),
        'utf-8',
      );

    it('grava RCON e os minecraft_settings antes do PVC existir', async () => {
      let propsWhenPvcWasCreated = '';
      const createPvc = driver.createPersistentVolumeClaim.bind(driver);
      driver.createPersistentVolumeClaim = async (manifest) => {
        propsWhenPvcWasCreated = readProps(server);
        return createPvc(manifest);
      };

      await service.provisionServer(server, settings);

      expect(propsWhenPvcWasCreated).toContain('enable-rcon=true');
      expect(propsWhenPvcWasCreated).toContain('rcon.password=lobby-rcon-secret');
      expect(propsWhenPvcWasCreated).toContain('motd=Lobby server');
      expect(propsWhenPvcWasCreated).toContain('max-players=50');
    });

    it('regrava ao iniciar para que um servidor criado sem o arquivo ganhe RCON', async () => {
      await service.provisionServer(server, settings);
      const propsPath = path.join(
        serversDataRoot,
        serverDataDirectory(server.resource_name),
        'server.properties',
      );
      fs.writeFileSync(propsPath, 'enable-rcon=false\nlevel-seed=abc\n');

      server.minecraft_settings = { ...settings, motd: 'Novo motd' } as MinecraftServerSettings;
      await service.startServer(server);

      const props = readProps(server);
      expect(props).toContain('enable-rcon=true');
      expect(props).toContain('motd=Novo motd');
      expect(props).toContain('level-seed=abc');
    });

    it('inicia um servidor carregado sem minecraft_settings com a senha RCON e as configurações do banco', async () => {
      const stored = { ...settings, rcon_password: 'senha-do-banco', motd: 'Do banco' };
      const settingsRepo = { findOneBy: jest.fn(async () => stored) };
      service = new KubernetesService(driver, mockConfigService, undefined, settingsRepo as any);
      server.minecraft_settings = undefined;

      await service.startServer(server);

      expect(settingsRepo.findOneBy).toHaveBeenCalledWith({ server_id: server.id });
      const props = readProps(server);
      expect(props).toContain('rcon.password=senha-do-banco');
      expect(props).toContain('motd=Do banco');
    });

    it('não grava server.properties para jogos que não são Minecraft', async () => {
      server.game_type = 'terraria';

      await service.provisionServer(server);

      expect(
        fs.existsSync(
          path.join(
            serversDataRoot,
            serverDataDirectory(server.resource_name),
            'server.properties',
          ),
        ),
      ).toBe(false);
    });
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

  // A subdomain is only an address: changing it must not move the server to other Kubernetes resources, or
  // start/stop/delete would miss the real ones and the reconciler would provision a second, empty set.
  describe('servidor com subdomínio trocado depois de provisionado', () => {
    let renamed: Server;

    beforeEach(async () => {
      await service.provisionServer(server, settings);
      renamed = { ...server, subdomain: 'novo-endereco' } as Server;
    });

    const k8sNames = () => [
      ...driver.pvcs.keys(),
      ...driver.services.keys(),
      ...driver.deployments.keys(),
    ];

    it('start e stop escalam o Deployment criado no provisionamento', async () => {
      await service.startServer(renamed);
      expect((await driver.getDeployment('mc-lobby', 'minekubernetes'))?.replicas).toBe(1);

      await service.stopServer(renamed);
      expect((await driver.getDeployment('mc-lobby', 'minekubernetes'))?.replicas).toBe(0);
      expect(k8sNames().filter((name) => name.includes('novo-endereco'))).toEqual([]);
    });

    it('getServerDeployment e getServerPodStats procuram o Deployment pelo nome estável', async () => {
      const getDeployment = jest.spyOn(driver, 'getDeployment');
      const getPodStats = jest.spyOn(driver, 'getPodStats');

      expect((await service.getServerDeployment(renamed))?.name).toBe('mc-lobby');
      await service.getServerPodStats(renamed);

      expect(getDeployment).toHaveBeenCalledWith('mc-lobby', 'minekubernetes');
      expect(getPodStats).toHaveBeenCalledWith('mc-lobby', 'minekubernetes');
    });

    it('deprovision remove exatamente o que o provisionamento criou', async () => {
      expect(k8sNames().sort()).toEqual([
        'minekubernetes/data-lobby',
        'minekubernetes/mc-lobby',
        'minekubernetes/mc-lobby',
      ]);

      await service.deprovisionServer(renamed);

      expect(k8sNames()).toEqual([]);
    });

    it('reescreve server.properties no diretório de dados original, não num diretório novo', async () => {
      await service.startServer({ ...renamed, minecraft_settings: settings } as Server);

      expect(fs.readdirSync(serversDataRoot)).toEqual(['data-lobby']);
    });
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
