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
        jvmRunnerImage: 'eclipse-temurin:21-jre-jammy',
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
      expect(affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms[0].matchExpressions[0].values).toContain('node-nvme-1');
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
      expect(script).toContain("-C /data/.snapshot_tmp .");
      expect(script).toContain("--exclude='logs/*'");
      expect(script).toContain("--exclude='crash-reports/*'");
      expect(script).toContain("--exclude='.cache/*'");
      expect(script).toContain("--exclude='.snapshot_tmp*'");
      expect(script).toContain('sha256sum');
    });

    it('should generate valid Job batch/v1 for COLD backup directly compressing from /data', () => {
      const timestamp = 1700000000;
      const job = ManifestBuilder.buildBackupJob(sampleServer, 'cold', timestamp, mockConfigService);

      expect(job.metadata.name).toBe('backup-smp-cold-1700000000');
      expect(job.metadata.labels['minekubernetes.io/backup-type']).toBe('cold');

      const script = job.spec.template.spec.containers[0].args[0];
      expect(script).toContain('-C /data .');
      expect(script).toContain("--exclude='logs/*'");
      expect(script).toContain('sha256sum');
      expect(script).not.toContain('.snapshot_worker_ready');
    });
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
