import { AppConfigService } from '@config/app-config.service';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';

const JAR_PROVIDED_TYPES = ['PAPER', 'PURPUR'];
const MC_VERSION_PATTERN = /^\d+(\.\d+){1,2}(-(pre|rc)\d+)?$/;

// O version/type chegam por env para nunca serem interpolados no script de shell.
const FETCH_SERVER_JAR_SCRIPT = [
  'set -eu',
  'want="$SERVER_TYPE-$MC_VERSION"',
  'if [ -s /data/server.jar ] && [ "$(cat /data/.server-jar 2>/dev/null)" = "$want" ]; then echo "server.jar $want ja presente"; exit 0; fi',
  'sha=""',
  'case "$SERVER_TYPE" in',
  '  PURPUR) url="https://api.purpurmc.org/v2/purpur/$MC_VERSION/latest/download" ;;',
  '  PAPER)',
  // Fill v3 exige User-Agent identificado; o wget padrao do busybox e recusado.
  '    meta=$(wget -q -U "minek8s-control-plane/1.0 (https://github.com/BGLuis/mineK8s)" -O - "https://fill.papermc.io/v3/projects/paper/versions/$MC_VERSION/builds/latest")',
  // Variavel de padrao: aspas literais dentro de ${meta#...} anulam o corte no sh.
  `    pat='*"server:default":'`,
  '    section=${meta#$pat}',
  "    url=$(printf %s \"$section\" | grep -o 'https://[^\"]*' | head -1)",
  "    sha=$(printf %s \"$section\" | grep -o '\"sha256\":\"[0-9a-f]*\"' | head -1 | cut -d'\"' -f4)",
  '    ;;',
  '  *) echo "tipo $SERVER_TYPE sem provedor de jar" >&2; exit 1 ;;',
  'esac',
  '[ -n "$url" ] || { echo "URL do jar nao encontrada para $want" >&2; exit 1; }',
  'wget -q -U "minek8s-control-plane/1.0 (https://github.com/BGLuis/mineK8s)" -O /data/server.jar.tmp "$url"',
  '[ -z "$sha" ] || echo "$sha  /data/server.jar.tmp" | sha256sum -c -',
  'mv /data/server.jar.tmp /data/server.jar',
  'echo "$want" > /data/.server-jar',
].join('\n');

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

  /** Where the gateway reaches the server: the game port of the Service that buildService creates. */
  public static routeTarget(server: Server, configService: AppConfigService): string {
    const namespace = configService.kubernetes.namespace;
    return `mc-${server.subdomain}.${namespace}.svc.cluster.local:${ManifestBuilder.serviceGamePort(server)}`;
  }

  private static serviceGamePort(server: Server): number {
    return server.allocated_port || 25565;
  }

  public static buildService(server: Server, configService: AppConfigService) {
    const namespace = configService.kubernetes.namespace;
    const listenPort = ManifestBuilder.serviceGamePort(server);
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

    const serverType = server.server_type.toUpperCase();
    const initContainers = JAR_PROVIDED_TYPES.includes(serverType)
      ? [ManifestBuilder.buildFetchServerJarInitContainer(serverType, server.game_version)]
      : undefined;

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
            initContainers,
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

  private static buildFetchServerJarInitContainer(serverType: string, gameVersion: string) {
    if (!MC_VERSION_PATTERN.test(gameVersion)) {
      throw new Error(`game_version invalida para download do server.jar: "${gameVersion}"`);
    }
    return {
      name: 'fetch-server-jar',
      image: 'alpine:3.20',
      command: ['/bin/sh', '-c'],
      args: [FETCH_SERVER_JAR_SCRIPT],
      env: [
        { name: 'SERVER_TYPE', value: serverType },
        { name: 'MC_VERSION', value: gameVersion },
      ],
      resources: {
        requests: { memory: '32Mi', cpu: '50m' },
        limits: { memory: '128Mi' },
      },
      volumeMounts: [{ name: 'server-data', mountPath: '/data' }],
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

  public static buildRestoreJob(
    server: Server,
    backupFilename: string,
    expectedSha256: string | undefined,
    timestamp: number,
    configService: AppConfigService,
  ) {
    const namespace = configService.kubernetes.namespace;
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

    const restoreScript = `set -e
BACKUP_TAR="/backups/${backupFilename}"
EXPECTED_SHA="${expectedSha256 || ''}"

echo "[Fase 1/5] Validando integridade criptográfica e estrutural do arquivo de backup..."
if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL_SHA=$(sha256sum "$BACKUP_TAR" | awk '{print $1}')
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "[ERRO CRITICO] Checksum SHA-256 divergente! Esperado: $EXPECTED_SHA, Obtido: $ACTUAL_SHA" >&2
    exit 1
  fi
fi

if ! tar -tzf "$BACKUP_TAR" > /dev/null 2>&1; then
  echo "[ERRO CRITICO] Arquivo tar.gz invalido ou corrompido!" >&2
  exit 1
fi

echo "[Fase 2/5] Isolando arquivos atuais em staging de seguranca..."
mkdir -p /data/.staging_safety
find /data -mindepth 1 -maxdepth 1 -not -name '.staging_safety' -not -name 'lost+found' -exec mv {} /data/.staging_safety/ \\;

echo "[Fase 3/5] Extraindo conteudo do backup para /data..."
RESTORE_FAILED=0
if ! tar -xzf "$BACKUP_TAR" -C /data; then
  echo "[ERRO] Falha durante descompactacao do tar!" >&2
  RESTORE_FAILED=1
fi

echo "[Fase 4/5] Validando sanidade e integridade dos arquivos restaurados..."
if [ $RESTORE_FAILED -eq 0 ]; then
  if [ ! -f /data/world/level.dat ] && [ ! -f /data/level.dat ]; then
    echo "[ERRO] level.dat ausente apos descompactacao!" >&2
    RESTORE_FAILED=1
  fi
  if [ ! -f /data/server.properties ]; then
    echo "[ERRO] server.properties ausente apos descompactacao!" >&2
    RESTORE_FAILED=1
  fi
fi

echo "[Fase 5/5] Executando Commit ou Rollback..."
if [ $RESTORE_FAILED -ne 0 ]; then
  echo "[ROLLBACK DISPARADO] Restaurando estado anterior a partir de .staging_safety..."
  find /data -mindepth 1 -maxdepth 1 -not -name '.staging_safety' -not -name 'lost+found' -exec rm -rf {} +
  find /data/.staging_safety -mindepth 1 -maxdepth 1 -exec mv {} /data/ \\;
  rm -rf /data/.staging_safety
  echo "[ROLLBACK CONCLUIDO] Estado original restaurado 100% intacto."
  exit 1
else
  rm -rf /data/.staging_safety
  echo "[COMMIT CONCLUIDO] Restauracao transacional finalizada com 100% de integridade."
fi
`;

    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: `restore-${server.subdomain}-${timestamp}`,
        namespace,
        labels: {
          'app.kubernetes.io/name': `restore-${server.subdomain}`,
          'app.kubernetes.io/part-of': 'minekubernetes',
          'app.kubernetes.io/component': 'restore-worker',
          'minekubernetes.io/server-id': server.id,
        },
      },
      spec: {
        ttlSecondsAfterFinished: 600,
        backoffLimit: 0,
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/name': `restore-${server.subdomain}`,
              'app.kubernetes.io/part-of': 'minekubernetes',
              'app.kubernetes.io/component': 'restore-worker',
              'job-name': `restore-${server.subdomain}-${timestamp}`,
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
                name: 'restore-worker',
                image: 'alpine:3.20',
                command: ['/bin/sh', '-c'],
                args: [restoreScript],
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
