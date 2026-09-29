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
                args: [`exec java ${aikarsFlags.join(' ')}`],
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
}
