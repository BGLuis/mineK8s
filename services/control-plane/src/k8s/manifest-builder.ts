import { AppConfigService } from '@config/app-config.service';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';

export class ManifestBuilder {
  public static buildPVC(server: Server, configService: AppConfigService) {
    const namespace = configService.kubernetes.namespace;
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: `data-${server.subdomain}`,
        namespace,
        labels: {
          'app.kubernetes.io/name': `mc-${server.subdomain}`,
          'app.kubernetes.io/part-of': 'minekubernetes',
          'app.kubernetes.io/component': 'game-server-storage',
          'minekubernetes.io/server-id': server.id,
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        storageClassName: 'local-nvme',
        resources: {
          requests: {
            storage: '25Gi',
          },
        },
      },
    };
  }

  public static buildService(server: Server, configService: AppConfigService) {
    const namespace = configService.kubernetes.namespace;
    const listenPort = server.allocated_port || 25565;
    return {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: `mc-${server.subdomain}`,
        namespace,
        labels: {
          'app.kubernetes.io/name': `mc-${server.subdomain}`,
          'app.kubernetes.io/part-of': 'minekubernetes',
          'minekubernetes.io/server-id': server.id,
        },
      },
      spec: {
        type: 'ClusterIP',
        selector: {
          'app.kubernetes.io/name': `mc-${server.subdomain}`,
        },
        ports: [
          {
            name: 'minecraft',
            port: listenPort,
            targetPort: 25565,
            protocol: 'TCP',
          },
          {
            name: 'rcon',
            port: 25575,
            targetPort: 25575,
            protocol: 'TCP',
          },
        ],
      },
    };
  }

  public static buildDeployment(
    server: Server,
    settings: MinecraftServerSettings | undefined,
    configService: AppConfigService,
  ) {
    const namespace = configService.kubernetes.namespace;
    const heapMb = server.allocated_memory_mb;
    const containerMemoryLimitMb = heapMb > 8192 ? heapMb + 2048 : heapMb + 1536; // Heap + 1.5/2 GiB (C-17, RF-ARQ-09)
    const isModpack = ['FORGE', 'NEOFORGE', 'FABRIC'].includes(
      server.server_type.toUpperCase(),
    );

    const aikarsFlags = [
      `-Xms${heapMb}M`,
      `-Xmx${heapMb}M`,
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      heapMb >= 12288 ? '-XX:G1HeapRegionSize=16M' : '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      '-Dusing.aikars.flags=https://mcflags.emc.gs',
      '-Daikars.new.flags=true',
      '-jar',
      'server.jar',
      'nogui',
    ];

    const affinity = configService.kubernetes.nodeAffinityValue
      ? {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: configService.kubernetes.nodeAffinityKey,
                      operator: 'In',
                      values: [configService.kubernetes.nodeAffinityValue],
                    },
                  ],
                },
              ],
            },
          },
        }
      : undefined;

    return {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: `mc-${server.subdomain}`,
        namespace,
        labels: {
          'app.kubernetes.io/name': `mc-${server.subdomain}`,
          'app.kubernetes.io/part-of': 'minekubernetes',
          'minekubernetes.io/server-id': server.id,
        },
      },
      spec: {
        replicas: server.state === 'READY' || server.state === 'STARTING' ? 1 : 0,
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': `mc-${server.subdomain}`,
          },
        },
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/name': `mc-${server.subdomain}`,
              'app.kubernetes.io/part-of': 'minekubernetes',
              'minekubernetes.io/server-id': server.id,
            },
          },
          spec: {
            affinity,
            terminationGracePeriodSeconds: 90,
            securityContext: {
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              fsGroupChangePolicy: 'OnRootMismatch',
            },
            containers: [
              {
                name: 'runner',
                image: configService.registry.jvmRunnerImage,
                workingDir: '/data',
                command: ['/bin/sh', '-c'],
                args: [
                  `if [ -f /data/world/session.lock ] && fuser -s /data/world/session.lock 2>/dev/null; then echo "[FATAL] Outro processo ainda esta segurando session.lock! Abortando boot." >&2; exit 1; fi; exec java ${aikarsFlags.join(' ')}`,
                ],
                resources: {
                  requests: {
                    memory: `${heapMb}Mi`,
                    cpu: '1000m',
                  },
                  limits: {
                    memory: `${containerMemoryLimitMb}Mi`,
                    // Sem CPU limit para prevenir throttling (RF-ARQ-09)
                  },
                },
                ports: [
                  {
                    name: 'minecraft',
                    containerPort: 25565,
                    protocol: 'TCP',
                  },
                  {
                    name: 'rcon',
                    containerPort: 25575,
                    protocol: 'TCP',
                  },
                ],
                volumeMounts: [
                  {
                    name: 'server-data',
                    mountPath: '/data',
                  },
                ],
                startupProbe: {
                  tcpSocket: {
                    port: 25565,
                  },
                  initialDelaySeconds: isModpack ? 30 : 15,
                  periodSeconds: 10,
                  timeoutSeconds: isModpack ? 3 : 2,
                  failureThreshold: isModpack ? 90 : 18,
                },
                readinessProbe: {
                  tcpSocket: {
                    port: 25565,
                  },
                  periodSeconds: 5,
                  failureThreshold: 3,
                },
              },
            ],
            volumes: [
              {
                name: 'server-data',
                persistentVolumeClaim: {
                  claimName: `data-${server.subdomain}`,
                },
              },
            ],
          },
        },
      },
    };
  }

  public static buildBackupJob(
    server: Server,
    backupType: 'hot' | 'cold',
    timestamp: number,
    configService: AppConfigService,
  ) {
    const namespace = configService.kubernetes.namespace;
    const filename = `${server.subdomain}_${backupType}_${timestamp}.tar.gz`;
    const affinity = configService.kubernetes.nodeAffinityKey
      ? {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: configService.kubernetes.nodeAffinityKey,
                      operator: 'In',
                      values: [configService.kubernetes.nodeAffinityValue],
                    },
                  ],
                },
              ],
            },
          },
        }
      : undefined;

    const hotScript = `set -e
echo "[1/4] Backup worker pronto. Notificando Control Plane..."
touch /data/.snapshot_worker_ready

echo "Aguardando sinal de snapshot do Control Plane..."
timeout 60 sh -c 'while [ ! -f /data/.snapshot_trigger ]; do sleep 0.05; done' || { echo "Timeout aguardando snapshot_trigger" >&2; exit 1; }

echo "[2/4] Criando snapshot rapido via CoW reflink..."
mkdir -p /data/.snapshot_tmp
find /data -mindepth 1 -maxdepth 1 -not -name '.snapshot_tmp' -not -name '.snapshot_trigger' -not -name '.snapshot_worker_ready' -not -name '.snapshot_ready' -not -name '.backups' -not -name 'logs' -not -name '.cache' -not -name 'crash-reports' -exec cp --reflink=auto -a {} /data/.snapshot_tmp/ \\;

touch /data/.snapshot_ready
rm -f /data/.snapshot_trigger /data/.snapshot_worker_ready
echo "Snapshot clonado. Control Plane liberado para save-on."

echo "[3/4] Compactando tar.gz a partir de .snapshot_tmp..."
tar --exclude='logs/*' \\
    --exclude='crash-reports/*' \\
    --exclude='.cache/*' \\
    --exclude='.snapshot_tmp*' \\
    --exclude='.staging_safety*' \\
    --exclude='*.log.gz' \\
    --exclude='*.log' \\
    --exclude='.backups*' \\
    -czf /backups/${filename} \\
    -C /data/.snapshot_tmp .

echo "[4/4] Calculando checksum SHA-256 e finalizando..."
sha256sum /backups/${filename} > /backups/${filename}.sha256
rm -rf /data/.snapshot_tmp /data/.snapshot_ready
echo "Hot backup concluido com sucesso."
`;

    const coldScript = `set -e
echo "[1/3] Iniciando Cold Backup direto de /data..."
tar --exclude='logs/*' \\
    --exclude='crash-reports/*' \\
    --exclude='.cache/*' \\
    --exclude='.snapshot_tmp*' \\
    --exclude='.staging_safety*' \\
    --exclude='*.log.gz' \\
    --exclude='*.log' \\
    --exclude='.backups*' \\
    -czf /backups/${filename} \\
    -C /data .

echo "[2/3] Calculando checksum SHA-256..."
sha256sum /backups/${filename} > /backups/${filename}.sha256
echo "Cold backup concluido com sucesso."
`;

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: `backup-${server.subdomain}-${backupType}-${timestamp}`,
        namespace,
        labels: {
          'app.kubernetes.io/name': `backup-${server.subdomain}`,
          'app.kubernetes.io/part-of': 'minekubernetes',
          'app.kubernetes.io/component': 'backup-worker',
          'minekubernetes.io/server-id': server.id,
          'minekubernetes.io/backup-type': backupType,
        },
      },
      spec: {
        ttlSecondsAfterFinished: 600,
        backoffLimit: 0,
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/name': `backup-${server.subdomain}`,
              'app.kubernetes.io/part-of': 'minekubernetes',
              'app.kubernetes.io/component': 'backup-worker',
              'job-name': `backup-${server.subdomain}-${backupType}-${timestamp}`,
            },
          },
          spec: {
            restartPolicy: 'Never',
            affinity,
            securityContext: {
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
            },
            containers: [
              {
                name: 'backup-worker',
                image: 'alpine:3.20',
                command: ['/bin/sh', '-c'],
                args: [backupType === 'hot' ? hotScript : coldScript],
                volumeMounts: [
                  {
                    name: 'data-volume',
                    mountPath: '/data',
                  },
                  {
                    name: 'backup-volume',
                    mountPath: '/backups',
                  },
                ],
              },
            ],
            volumes: [
              {
                name: 'data-volume',
                persistentVolumeClaim: {
                  claimName: `data-${server.subdomain}`,
                },
              },
              {
                name: 'backup-volume',
                persistentVolumeClaim: {
                  claimName: 'backup-storage',
                },
              },
            ],
          },
        },
      },
    };
  }
}
