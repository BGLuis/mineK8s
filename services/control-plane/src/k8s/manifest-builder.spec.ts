import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AppConfigService } from '@config/app-config.service';
import { Server } from '@database/entities/server.entity';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { ManifestBuilder } from './manifest-builder';

describe('ManifestBuilder', () => {
  let mockConfigService: AppConfigService;
  let sampleServer: Server;
  let sampleSettings: MinecraftServerSettings;

  beforeEach(() => {
    mockConfigService = {
      kubernetes: {
        namespace: 'minekubernetes',
        nodeAffinityKey: 'kubernetes.io/hostname',
        nodeAffinityValue: 'node-nvme-1',
      },
      registry: {
        jvmRunnerImage: 'eclipse-temurin:{java}-jre-jammy',
      },
    } as any;

    sampleServer = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Survival SMP',
      subdomain: 'smp',
      game_type: 'minecraft',
      routing_model: 'sni-shared-port',
      server_type: 'PAPER',
      game_version: '1.20.4',
      allocated_memory_mb: 4096,
      allocated_port: null,
      state: 'STOPPED',
    } as Server;

    sampleSettings = {
      motd: 'Welcome to SMP',
      max_players: 20,
    } as MinecraftServerSettings;
  });

  describe('buildPVC (RF-STO-06, RF-ARQ-12)', () => {
    it('should generate PVC with local-nvme storage class and 25Gi capacity', () => {
      const pvc = ManifestBuilder.buildPVC(sampleServer, mockConfigService);

      expect(pvc.metadata.name).toBe('data-smp');
      expect(pvc.metadata.namespace).toBe('minekubernetes');
      expect(pvc.spec.storageClassName).toBe('local-nvme');
      expect(pvc.spec.resources.requests.storage).toBe('25Gi');
      expect(pvc.spec.accessModes).toContain('ReadWriteOnce');
    });
  });

  describe('buildService', () => {
    it('should generate ClusterIP service with Minecraft and RCON ports', () => {
      const svc = ManifestBuilder.buildService(sampleServer, mockConfigService);

      expect(svc.metadata.name).toBe('mc-smp');
      expect(svc.spec.type).toBe('ClusterIP');
      expect(svc.spec.ports).toEqual([
        { name: 'minecraft', port: 25565, targetPort: 25565, protocol: 'TCP' },
        { name: 'rcon', port: 25575, targetPort: 25575, protocol: 'TCP' },
      ]);
    });
  });

  describe('buildDeployment (RF-ARQ-09, RF-ARQ-10, RF-STO-07)', () => {
    it('should configure securityContext with UID/GID 1000 and fsGroupChangePolicy OnRootMismatch', () => {
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const spec = dep.spec.template.spec;

      expect(spec.securityContext).toEqual({
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        fsGroupChangePolicy: 'OnRootMismatch',
      });
      expect(spec.terminationGracePeriodSeconds).toBe(90);
    });

    it('should configure memory requests equal to heap and limits equal to heap + 1.5Gi for <= 8G (RF-ARQ-09, C-17)', () => {
      sampleServer.allocated_memory_mb = 4096;
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const container = dep.spec.template.spec.containers[0];

      expect(container.resources.requests.memory).toBe('4096Mi');
      expect(container.resources.requests.cpu).toBe('1000m');
      // 4096 + 1536 = 5632
      expect(container.resources.limits.memory).toBe('5632Mi');
      expect((container.resources.limits as any).cpu).toBeUndefined(); // Sem CPU limit para evitar throttling
    });

    it('should configure memory limits equal to heap + 2Gi for > 8G modpack (RF-ARQ-09, C-17)', () => {
      sampleServer.allocated_memory_mb = 12288;
      sampleServer.server_type = 'FORGE';
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const container = dep.spec.template.spec.containers[0];

      expect(container.resources.requests.memory).toBe('12288Mi');
      // 12288 + 2048 = 14336
      expect(container.resources.limits.memory).toBe('14336Mi');
      expect((container.resources.limits as any).cpu).toBeUndefined();
    });

    it('should recreate the pod instead of rolling it, so two JVMs never share the world volume', () => {
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);

      expect(dep.spec.strategy).toEqual({ type: 'Recreate' });
    });

    it('should include Aikar flags including AlwaysPreTouch and G1GC parameters (RF-ARQ-10)', () => {
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const container = dep.spec.template.spec.containers[0];
      const argsString = container.args[0];

      expect(argsString).toContain('-Xms4096M');
      expect(argsString).toContain('-Xmx4096M');
      expect(argsString).toContain('-XX:+UseG1GC');
      expect(argsString).toContain('-XX:+AlwaysPreTouch');
      expect(argsString).toContain('-XX:MaxGCPauseMillis=200');
      expect(argsString).toContain('-Daikars.new.flags=true');
    });

    it('should configure node affinity when configured', () => {
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const affinity = dep.spec.template.spec.affinity;

      expect(affinity).toBeDefined();
      expect(
        affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms[0]
          .matchExpressions[0].values,
      ).toContain('node-nvme-1');
    });

    it('should adjust startupProbe for modpacks', () => {
      sampleServer.server_type = 'FORGE';
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      const probe = dep.spec.template.spec.containers[0].startupProbe;

      expect(probe.failureThreshold).toBe(90);
      expect(probe.initialDelaySeconds).toBe(30);
    });

    it('should set terminationGracePeriodSeconds to 90 and include session.lock fuser check in entrypoint (RF-ARQ-08, RF-STO-09)', () => {
      const dep = ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService);
      expect(dep.spec.template.spec.terminationGracePeriodSeconds).toBe(90);

      const container = dep.spec.template.spec.containers[0];
      expect(container.args[0]).toContain('fuser -s /data/world/session.lock');
      expect(container.args[0]).toContain('exec java');
    });

    describe('server.jar resolvido no registro (#102, #154, #157)', () => {
      const PAPER_JAR =
        'https://fill-data.papermc.io/v1/objects/5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba/paper-1.21.11-132.jar';
      const PAPER_CHECKSUM =
        'sha256:5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba';

      const initContainersOf = (dep: ReturnType<typeof ManifestBuilder.buildDeployment>) =>
        dep.spec.template.spec.initContainers;

      it('should fetch the resolved jar into the data volume before the runner starts', () => {
        sampleServer.server_jar_url = PAPER_JAR;
        sampleServer.server_jar_checksum = PAPER_CHECKSUM;

        const init = initContainersOf(
          ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService),
        )![0];

        expect(init.name).toBe('fetch-server-jar');
        expect(init.env).toEqual([
          { name: 'SERVER_JAR_URL', value: PAPER_JAR },
          { name: 'SERVER_JAR_CHECKSUM', value: PAPER_CHECKSUM },
        ]);
        expect(init.volumeMounts).toEqual([{ name: 'server-data', mountPath: '/data' }]);
      });

      it.each(['FORGE', 'NEOFORGE', 'FABRIC'])(
        'should not add a jar init container for %s, whose installer provides the jar',
        (type) => {
          sampleServer.server_type = type;
          sampleServer.server_jar_url = null;
          sampleServer.server_jar_checksum = null;
          const dep = ManifestBuilder.buildDeployment(
            sampleServer,
            sampleSettings,
            mockConfigService,
          );

          expect(initContainersOf(dep)).toBeUndefined();
        },
      );

      describe('script do init container', () => {
        let workDir: string;
        let dataDir: string;
        let jarSource: string;
        let wgetLog: string;
        let script: string;

        const JAR = Buffer.from('fake server jar');
        const digest = (algorithm: string, content: Buffer = JAR) =>
          createHash(algorithm).update(content).digest('hex');

        const runScript = (checksum: string) =>
          spawnSync('/bin/sh', ['-c', script], {
            encoding: 'utf8',
            env: {
              PATH: `${path.join(workDir, 'bin')}:${process.env.PATH}`,
              SERVER_JAR_URL: 'https://downloads.test/server.jar',
              SERVER_JAR_CHECKSUM: checksum,
              JAR_SOURCE: jarSource,
              WGET_LOG: wgetLog,
            },
          });

        beforeEach(() => {
          workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-server-jar-'));
          dataDir = path.join(workDir, 'data');
          jarSource = path.join(workDir, 'upstream.jar');
          wgetLog = path.join(workDir, 'wget.log');
          fs.mkdirSync(dataDir);
          fs.mkdirSync(path.join(workDir, 'bin'));
          fs.writeFileSync(jarSource, JAR);
          // Stands in for busybox wget: records the URL and "downloads" JAR_SOURCE to the -O path.
          fs.writeFileSync(
            path.join(workDir, 'bin', 'wget'),
            [
              '#!/bin/sh',
              'while [ $# -gt 0 ]; do case "$1" in -O) out="$2"; shift 2 ;; *) url="$1"; shift ;; esac; done',
              'echo "$url" >> "$WGET_LOG"',
              'cp "$JAR_SOURCE" "$out"',
            ].join('\n'),
            { mode: 0o755 },
          );

          sampleServer.server_jar_url = 'https://downloads.test/server.jar';
          sampleServer.server_jar_checksum = `sha1:${digest('sha1')}`;
          const init = initContainersOf(
            ManifestBuilder.buildDeployment(sampleServer, sampleSettings, mockConfigService),
          )![0];
          script = init.args[0].replaceAll('/data', dataDir);
        });

        afterEach(() => {
          fs.rmSync(workDir, { recursive: true, force: true });
        });

        it.each(['sha1', 'sha256', 'md5'])(
          'installs a jar whose %s matches and records the checksum',
          (algorithm) => {
            const checksum = `${algorithm}:${digest(algorithm)}`;

            const run = runScript(checksum);

            expect(run.status).toBe(0);
            expect(fs.readFileSync(path.join(dataDir, 'server.jar'))).toEqual(JAR);
            expect(fs.readFileSync(path.join(dataDir, '.server-jar'), 'utf8').trim()).toBe(
              checksum,
            );
            expect(fs.readFileSync(wgetLog, 'utf8').trim()).toBe(
              'https://downloads.test/server.jar',
            );
          },
        );

        it('refuses a jar whose sha1 differs from the declared one and leaves no jar behind', () => {
          const run = runScript(`sha1:${digest('sha1', Buffer.from('another jar'))}`);

          expect(run.status).not.toBe(0);
          expect(run.stderr).toContain('nao confere');
          expect(fs.readdirSync(dataDir)).toEqual(['eula.txt']);
        });

        it('keeps the installed jar when a refetch does not match', () => {
          fs.writeFileSync(path.join(dataDir, 'server.jar'), 'old jar');
          fs.writeFileSync(path.join(dataDir, '.server-jar'), 'sha1:old\n');

          const run = runScript(`sha1:${digest('sha1', Buffer.from('another jar'))}`);

          expect(run.status).not.toBe(0);
          expect(fs.readFileSync(path.join(dataDir, 'server.jar'), 'utf8')).toBe('old jar');
        });

        it('does not download again a jar already installed with the same checksum', () => {
          const checksum = `sha1:${digest('sha1')}`;
          expect(runScript(checksum).status).toBe(0);

          const run = runScript(checksum);

          expect(run.status).toBe(0);
          expect(fs.readFileSync(wgetLog, 'utf8').trim().split('\n')).toHaveLength(1);
        });

        it('accepts the EULA even when the jar is already installed', () => {
          const checksum = `sha1:${digest('sha1')}`;
          fs.writeFileSync(path.join(dataDir, 'server.jar'), JAR);
          fs.writeFileSync(path.join(dataDir, '.server-jar'), `${checksum}\n`);
          fs.writeFileSync(path.join(dataDir, 'eula.txt'), 'eula=false\n');

          const run = runScript(checksum);

          expect(run.status).toBe(0);
          expect(fs.readFileSync(path.join(dataDir, 'eula.txt'), 'utf8')).toBe('eula=true\n');
        });

        it('refuses a checksum without a known algorithm', () => {
          const run = runScript(`crc32:${digest('sha1')}`);

          expect(run.status).not.toBe(0);
          expect(fs.existsSync(wgetLog)).toBe(false);
        });
      });
    });

    describe('imagem do runner por versão do Java (#156)', () => {
      it('should fill the image template with the Java version resolved for the server', () => {
        (mockConfigService.registry as any).jvmRunnerImage = 'eclipse-temurin:{java}-jre-jammy';
        sampleServer.java_version = 25;

        const dep = ManifestBuilder.buildDeployment(
          sampleServer,
          sampleSettings,
          mockConfigService,
        );

        expect(dep.spec.template.spec.containers[0].image).toBe('eclipse-temurin:25-jre-jammy');
      });

      it('should keep Java 21 for a server created before the Java version was resolved', () => {
        (mockConfigService.registry as any).jvmRunnerImage = 'eclipse-temurin:{java}-jre-jammy';
        sampleServer.java_version = null;

        const dep = ManifestBuilder.buildDeployment(
          sampleServer,
          sampleSettings,
          mockConfigService,
        );

        expect(dep.spec.template.spec.containers[0].image).toBe('eclipse-temurin:21-jre-jammy');
      });

      it('should use an image without the {java} placeholder as is, for every server', () => {
        (mockConfigService.registry as any).jvmRunnerImage = 'registry.local/runner:custom';
        sampleServer.java_version = 8;

        const dep = ManifestBuilder.buildDeployment(
          sampleServer,
          sampleSettings,
          mockConfigService,
        );

        expect(dep.spec.template.spec.containers[0].image).toBe('registry.local/runner:custom');
      });
    });
  });

  describe('buildBackupJob (RF-STO-01, RF-STO-02, RF-STO-10, D-01..D-04)', () => {
    it('should generate valid Job batch/v1 for HOT backup with pre-heating and CoW snapshot script', () => {
      const timestamp = 1700000000;
      const job = ManifestBuilder.buildBackupJob(sampleServer, 'hot', timestamp, mockConfigService);

      expect(job.apiVersion).toBe('batch/v1');
      expect(job.kind).toBe('Job');
      expect(job.metadata.name).toBe('backup-smp-hot-1700000000');
      expect(job.metadata.namespace).toBe('minekubernetes');
      expect(job.metadata.labels['minekubernetes.io/backup-type']).toBe('hot');

      const podSpec = job.spec.template.spec;
      expect(podSpec.restartPolicy).toBe('Never');
      expect(podSpec.securityContext.runAsUser).toBe(1000);
      expect(podSpec.securityContext.fsGroup).toBe(1000);

      // Volume mounts (RF-STO-01, RF-STO-02)
      expect(podSpec.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'data-volume',
            persistentVolumeClaim: { claimName: 'data-smp' },
          }),
          expect.objectContaining({
            name: 'backup-volume',
            persistentVolumeClaim: { claimName: 'backup-storage' },
          }),
        ]),
      );

      const container = podSpec.containers[0];
      expect(container.name).toBe('backup-worker');
      expect(container.image).toBe('alpine:3.20');

      const script = container.args[0];
      // Notification of worker ready for pre-heating (D-04)
      expect(script).toContain('.snapshot_worker_ready');
      expect(script).toContain('.snapshot_trigger');
      // CoW reflink snapshot (D-03)
      expect(script).toContain('cp --reflink=auto -a');
      expect(script).toContain('.snapshot_tmp');
      // Tar compressing from .snapshot_tmp (D-01) with standard exclusions (RF-STO-10)
      expect(script).toContain('-C /data/.snapshot_tmp .');
      expect(script).toContain("--exclude='logs/*'");
      expect(script).toContain("--exclude='crash-reports/*'");
      expect(script).toContain("--exclude='.cache/*'");
      expect(script).toContain("--exclude='.snapshot_tmp*'");
      expect(script).toContain('sha256sum');
    });

    it('should generate valid Job batch/v1 for COLD backup directly compressing from /data', () => {
      const timestamp = 1700000000;
      const job = ManifestBuilder.buildBackupJob(
        sampleServer,
        'cold',
        timestamp,
        mockConfigService,
      );

      expect(job.metadata.name).toBe('backup-smp-cold-1700000000');
      expect(job.metadata.labels['minekubernetes.io/backup-type']).toBe('cold');

      const script = job.spec.template.spec.containers[0].args[0];
      expect(script).toContain('-C /data .');
      expect(script).toContain("--exclude='logs/*'");
      expect(script).toContain('sha256sum');
      expect(script).not.toContain('.snapshot_worker_ready');
    });
  });

  // Só a chave tem padrão (kubernetes.io/hostname): exigir hostname vazio deixaria o Job sem nó para rodar.
  it.each([
    [
      'backup',
      (config: AppConfigService) => ManifestBuilder.buildBackupJob(sampleServer, 'cold', 1, config),
    ],
    [
      'restore',
      (config: AppConfigService) =>
        ManifestBuilder.buildRestoreJob(sampleServer, 'x.tar.gz', undefined, 1, config),
    ],
  ])('o Job de %s não exige nó quando KUBERNETES_NODE_AFFINITY_VALUE está vazia', (_, build) => {
    const config = {
      ...mockConfigService,
      kubernetes: { ...mockConfigService.kubernetes, nodeAffinityValue: undefined },
    } as AppConfigService;

    expect(build(config).spec.template.spec.affinity).toBeUndefined();
  });

  describe('buildRestoreJob (RF-STO-04, D-05)', () => {
    it('should generate valid Job batch/v1 for transactional restore with staging and rollback script', () => {
      const timestamp = 1700000000;
      const expectedSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const backupFilename = 'smp_hot_1699999999.tar.gz';
      const job = ManifestBuilder.buildRestoreJob(
        sampleServer,
        backupFilename,
        expectedSha256,
        timestamp,
        mockConfigService,
      );

      expect(job.apiVersion).toBe('batch/v1');
      expect(job.kind).toBe('Job');
      expect(job.metadata.name).toBe('restore-smp-1700000000');
      expect(job.metadata.namespace).toBe('minekubernetes');
      expect(job.metadata.labels['app.kubernetes.io/component']).toBe('restore-worker');

      const podSpec = job.spec.template.spec;
      expect(podSpec.restartPolicy).toBe('Never');
      expect(podSpec.securityContext.runAsUser).toBe(1000);
      expect(podSpec.securityContext.fsGroup).toBe(1000);

      // Volume mounts
      expect(podSpec.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'data-volume',
            persistentVolumeClaim: { claimName: 'data-smp' },
          }),
          expect.objectContaining({
            name: 'backup-volume',
            persistentVolumeClaim: { claimName: 'backup-storage' },
          }),
        ]),
      );

      // Affinity check (D-05)
      expect(podSpec.affinity).toBeDefined();

      const script = podSpec.containers[0].args[0];
      // Phase 1: Cryptographic check
      expect(script).toContain('sha256sum');
      expect(script).toContain(expectedSha256);
      expect(script).toContain('tar -tzf');
      // Phase 2: Staging with dotfile and lost+found protection (D-05)
      expect(script).toContain('.staging_safety');
      expect(script).toContain("-not -name 'lost+found'");
      // Phase 3: Extraction
      expect(script).toContain('tar -xzf');
      // Phase 4: Sanity check
      expect(script).toContain('level.dat');
      expect(script).toContain('server.properties');
      // Phase 5: Rollback
      expect(script).toContain('ROLLBACK DISPARADO');
      expect(script).toContain('COMMIT CONCLUIDO');
    });
  });
});
