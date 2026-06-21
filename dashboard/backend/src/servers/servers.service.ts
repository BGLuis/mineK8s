import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { PrismaService } from '../prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CreateServerDto {
  name: string;
  source: 'CurseForge' | 'Modrinth' | 'Vanilla';
  modpackId?: string;
  modpackSlug?: string;
  version?: string; // Para servidores Vanilla
  /**
   * Minutos de inatividade (0 jogadores) antes de hibernar automaticamente.
   * null ou undefined = Always On (nunca hiberna).
   * Exemplo: 30 = hiberna após 30 minutos sem jogadores.
   */
  hibernateAfterMinutes?: number | null;
  memoryAllocated?: string; // Ex: '4G', '8G'
}

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);
  private k8sApi: k8s.CoreV1Api;
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sBatch: k8s.BatchV1Api;
  private curseforgeApiKey = '$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC';

  constructor(private prisma: PrismaService) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    this.k8sBatch = kc.makeApiClient(k8s.BatchV1Api);
  }

  async createServer(dto: CreateServerDto) {
    // Agora o ID do K8s é baseado no nome personalizado que o usuário escolheu, com um sulfixo pra garantir unicidade
    const safeName = dto.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const serverName = `mc-${safeName}-${randomSuffix}`.substring(0, 60);
    const namespace = 'default';

    this.logger.log(`Provisioning new server: ${serverName}`);

    const pvcManifest: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: `${serverName}-pvc` },
      spec: {
        accessModes: ['ReadWriteOnce'],
        storageClassName: 'local-path',
        resources: { requests: { storage: '10Gi' } },
      },
    };

    const deploymentManifest: k8s.V1Deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { 
        name: serverName,
        labels: {
          // Label de hibernação: 'never' = Always On | '30' = 30 minutos
          'minekube/hibernate-after-minutes':
            dto.hibernateAfterMinutes != null
              ? String(dto.hibernateAfterMinutes)
              : 'never',
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: serverName } },
        template: {
          metadata: { labels: { app: serverName } },
          spec: {
            containers: [{
              name: 'minecraft',
              image: 'itzg/minecraft-server',
              ports: [{ containerPort: 25565 }],
              env: Object.entries({
                EULA: 'TRUE',
                MEMORY: dto.memoryAllocated || '4G',
                JVM_XX_OPTS: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
                ...(dto.source === 'CurseForge' ? {
                  TYPE: 'AUTO_CURSEFORGE',
                  CF_SLUG: dto.modpackSlug,
                  ...(dto.version && { CF_FILE_ID: dto.version }),
                  CF_API_KEY: process.env.CF_API_KEY || '$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC'
                } : dto.source === 'Vanilla' ? {
                  TYPE: 'VANILLA',
                  VERSION: dto.version || 'LATEST'
                } : {
                  TYPE: 'MODRINTH',
                  MODRINTH_MODPACK: dto.modpackSlug,
                  ...(dto.version && { MODRINTH_VERSION: dto.version })
                })
              }).map(([name, value]) => ({ name, value })),
              resources: {
                limits: { memory: `${parseInt(dto.memoryAllocated || '4') + 1}Gi` }, // +1G de margem off-heap
                requests: { memory: `${parseInt(dto.memoryAllocated || '4')}Gi` }
              },
              livenessProbe: {
                exec: { command: ["mc-monitor", "status", "--host", "localhost", "--port", "25565"] },
                initialDelaySeconds: 120,
                periodSeconds: 30,
                failureThreshold: 10
              },
              readinessProbe: {
                exec: { command: ["mc-monitor", "status", "--host", "localhost", "--port", "25565"] },
                initialDelaySeconds: 30,
                periodSeconds: 10,
                failureThreshold: 60 // Até 10 minutos carregando mods sem o k8s matar
              },
              volumeMounts: [{ name: 'data', mountPath: '/data' }]
            }],
            volumes: [{ name: 'data', persistentVolumeClaim: { claimName: `${serverName}-pvc` } }]
          }
        }
      }
    };

    const serviceManifest: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { 
        name: `${serverName}-svc`,
        annotations: {
          'mc-router.itzg.me/externalServerName': `${safeName}.testmine.luiis.com.br`
        }
      },
      spec: {
        selector: { app: serverName },
        ports: [{ port: 25565, targetPort: 25565 }],
        type: 'ClusterIP'
      }
    };

    try {
      try {
        await this.k8sApi.createNamespacedPersistentVolumeClaim({namespace, body: pvcManifest});
      } catch (e) { if (e.statusCode !== 409) console.log(e); } // Ignore already exists

      try {
        await this.k8sAppsApi.createNamespacedDeployment({namespace, body: deploymentManifest});
      } catch (e) { if (e.statusCode !== 409) console.log(e); }

      try {
        await this.k8sApi.createNamespacedService({namespace, body: serviceManifest});
      } catch (e) { if (e.statusCode !== 409) console.log(e); }

      return {
        status: 'provisioning',
        serverName,
        message: `Servidor ${dto.name} está sendo criado no Kubernetes!`
      };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao criar servidor no Kubernetes', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getServers() {
    try {
      const namespace = 'default';
      const [deploymentsRes, servicesRes] = await Promise.all([
        this.k8sAppsApi.listNamespacedDeployment({ namespace }),
        this.k8sApi.listNamespacedService({ namespace })
      ]);
      
      const mcDeployments = deploymentsRes.items.filter(d => d.metadata?.name?.startsWith('mc-'));
      
      return mcDeployments.map(d => {
        const ready = d.status?.readyReplicas || 0;
        const desired = d.spec?.replicas || 0;
        
        let status = 'Iniciando';
        if (desired === 0) status = 'Desligado';
        else if (ready > 0) status = 'Online';

        // Encontrar a porta NodePort do Service vinculado a este servidor
        const svc = servicesRes.items.find(s => s.metadata?.name === `${d.metadata?.name}-svc`);
        const nodePort = svc?.spec?.ports?.[0]?.nodePort || null;
        const externalDomain = svc?.metadata?.annotations?.['mc-router.itzg.me/externalServerName'] || null;

        return {
          id: d.metadata?.name,
          name: d.metadata?.name?.replace('mc-', '').toUpperCase(),
          status: status,
          readyReplicas: ready,
          desiredReplicas: desired,
          connectionPort: nodePort,
          connectionDomain: externalDomain
        };
      });
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao listar servidores no Kubernetes', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async scaleServer(name: string, replicas: number) {
    const namespace = 'default';
    try {
      const deployment = await this.k8sAppsApi.readNamespacedDeployment({name, namespace});
      if (deployment && deployment.spec) {
        deployment.spec.replicas = replicas;
        await this.k8sAppsApi.replaceNamespacedDeployment({name, namespace, body: deployment});
      }
      return { message: `Servidor ${name} escalado para ${replicas} replicas.` };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao alterar estado do servidor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteServer(name: string) {
    const namespace = 'default';
    try {
      try { await this.k8sAppsApi.deleteNamespacedDeployment({name, namespace}); } catch(e){}
      try { await this.k8sApi.deleteNamespacedService({name: `${name}-svc`, namespace}); } catch(e){}
      try { await this.k8sApi.deleteNamespacedPersistentVolumeClaim({name: `${name}-pvc`, namespace}); } catch(e){}
      return { message: `Servidor ${name} e seus dados foram excluídos.` };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao excluir servidor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async getPodName(deploymentId: string) {
    const res = await this.k8sApi.listNamespacedPod({
      namespace: 'default',
      labelSelector: `app=${deploymentId}`
    });
    const pod = res.items.find(p => p.status?.phase === 'Running');
    if (!pod || !pod.metadata || !pod.metadata.name) {
      throw new HttpException('Servidor não possui Pods rodando no momento', HttpStatus.BAD_REQUEST);
    }
    return pod.metadata.name;
  }

  async getLogs(id: string) {
    try {
      const podName = await this.getPodName(id);
      const res = await this.k8sApi.readNamespacedPodLog({
        name: podName,
        namespace: 'default',
        container: 'minecraft',
        tailLines: 150
      });
      return { logs: res };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao ler logs do console', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async sendCommand(id: string, command: string) {
    try {
      const podName = await this.getPodName(id);
      const { stdout } = await execAsync(`kubectl exec ${podName} --kubeconfig ~/.kube/config -- rcon-cli "${command}"`);
      return { response: stdout.trim() };
    } catch (error) {
      this.logger.error(`RCON Error no pod: ${error.message}`);
      throw new HttpException('O servidor de Minecraft não está totalmente online ainda, ou o RCON falhou porque o modpack não baixou corretamente.', HttpStatus.BAD_REQUEST);
    }
  }

  async getPlayers(id: string) {
    try {
      // 1. Obter nome real do server no banco de dados para a busca ACL
      // O frontend passa o ID k8s (ex: "mc-vanilla-xyz"), no BD ele pode estar como "vanilla-xyz" ou podemos buscar via k8sServiceName
      const serverDb = await this.prisma.server.findFirst({
        where: {
          k8sServiceName: `${id}-svc` // Pelo padrão do projeto, o svc é mc-xyz-svc
        },
        include: {
          groups: true // Grupos de usuários autorizados
        }
      });

      // 2. Tentar buscar jogadores online no RCON
      let onlinePlayersRaw: string[] = [];
      let onlineCount = 0;
      let maxCount = 0;
      
      try {
        const { response } = await this.sendCommand(id, 'list');
        const match = response.match(/There are (\d+) of a max of (\d+) players online:(.*)/);
        if (match) {
          onlineCount = parseInt(match[1], 10);
          maxCount = parseInt(match[2], 10);
          const namesStr = match[3].trim();
          if (namesStr) {
            onlinePlayersRaw = namesStr.split(',').map(n => n.trim().toLowerCase());
          }
        }
      } catch (err) {
        // Ignora erro de RCON (servidor offline, iniciando ou falhou)
      }

      // 3. Obter todos os usuários da base
      const allUsers = await this.prisma.user.findMany({
        include: {
          groups: true // Grupos aos quais o usuário pertence
        }
      });

      const authorizedGroupIds = serverDb ? serverDb.groups.map(g => g.groupId) : [];

      const players = allUsers.map(user => {
        const hasAccess = user.groups.some(ug => authorizedGroupIds.includes(ug.groupId)) || user.role === 'ADMIN';
        const minecraftNick = user.minecraftNick || user.email?.split('@')[0] || 'Unknown';
        const isOnline = onlinePlayersRaw.includes(minecraftNick.toLowerCase());

        return {
          name: minecraftNick,
          uuid: 'Autenticado via Tailscale',
          ping: isOnline ? 'OK' : 'N/A',
          avatarUrl: `https://minotar.net/helm/${minecraftNick}/64.png`,
          hasAccess: hasAccess,
          isOnline: isOnline,
          role: user.role
        };
      });

      return {
        online: onlineCount,
        max: maxCount,
        players: players
      };

    } catch (error) {
      this.logger.error(error);
      return { online: 0, max: 0, players: [], error: 'Falha ao buscar usuários e permissões.' };
    }
  }

  async listFiles(id: string, path: string = '') {
    try {
      const podName = await this.getPodName(id);
      const safePath = path.replace(/[^a-zA-Z0-9_\-\.\/]/g, '').replace(/\.\./g, '');
      const targetDir = safePath ? `/data/${safePath}` : `/data`;
      
      const { stdout } = await execAsync(`kubectl exec ${podName} --kubeconfig ~/.kube/config -- ls -lah --group-directories-first ${targetDir}`);
      
      const lines = stdout.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('total'));
      const files = lines.map(line => {
        const parts = line.split(/\s+/);
        if (parts.length < 9) return null;
        const isDir = parts[0].startsWith('d');
        const size = parts[4];
        const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
        const name = parts.slice(8).join(' ');
        if (name === '.' || name === '..') return null;
        return { name, isDir, size, date };
      }).filter(Boolean);

      return { path: targetDir, files };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao listar arquivos internos', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async readFile(id: string, filePath: string) {
    try {
      const podName = await this.getPodName(id);
      const safePath = filePath.replace(/[^a-zA-Z0-9_\-\.\/]/g, '').replace(/\.\./g, '');
      const { stdout } = await execAsync(`kubectl exec ${podName} --kubeconfig ~/.kube/config -- cat /data/${safePath}`);
      return { content: stdout };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao ler o arquivo', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async writeFile(id: string, filePath: string, content: string) {
    const podName = await this.getPodName(id);
    const safePath = filePath.replace(/\.\./g, '').replace(/[^a-zA-Z0-9_\-\.\/]/g, '');

    if (!safePath) {
      throw new HttpException('Caminho de arquivo inválido.', HttpStatus.BAD_REQUEST);
    }

    const fullPath = `/data/${safePath}`;

    return new Promise<{ message: string }>((resolve, reject) => {
      // Usa stdin pipe para evitar problemas com caracteres especiais no conteúdo
      const child = exec(
        `kubectl exec -i ${podName} --kubeconfig ~/.kube/config -- sh -c "cat > ${fullPath}"`,
        (error, _stdout, stderr) => {
          if (error) {
            this.logger.error(`writeFile error: ${stderr}`);
            reject(new HttpException('Falha ao salvar o arquivo no pod.', HttpStatus.INTERNAL_SERVER_ERROR));
          } else {
            resolve({ message: `Arquivo ${safePath} salvo com sucesso.` });
          }
        },
      );

      if (child.stdin) {
        child.stdin.write(content);
        child.stdin.end();
      } else {
        reject(new HttpException('Não foi possível acessar stdin do processo.', HttpStatus.INTERNAL_SERVER_ERROR));
      }
    });
  }

  async deleteFile(id: string, filePath: string) {
    const podName = await this.getPodName(id);
    // Sanitização rigorosa: apenas alfanuméricos, hífens, underscores, pontos e barras
    const safePath = filePath.replace(/\.\./g, '').replace(/[^a-zA-Z0-9_\-\.\/]/g, '');

    if (!safePath) {
      throw new HttpException('Caminho de arquivo inválido.', HttpStatus.BAD_REQUEST);
    }

    const fullPath = `/data/${safePath}`;

    try {
      // rm -rf é seguro aqui pois o caminho está restrito ao /data/ do pod
      await execAsync(
        `kubectl exec ${podName} --kubeconfig ~/.kube/config -- rm -rf ${fullPath}`,
      );
      return { status: "Success", message: `Arquivo removido com sucesso` };
    } catch (error) {
      this.logger.error(error);
      throw new HttpException('Falha ao deletar o arquivo/pasta no pod.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ---------------------------------------------------------------------------
  // Upload & Extração de Mundos
  // ---------------------------------------------------------------------------
  async uploadWorld(id: string, file: Express.Multer.File) {
    if (!file) throw new HttpException('Nenhum arquivo enviado', 400);

    const isZip = file.originalname.endsWith('.zip');
    const isTarGz = file.originalname.endsWith('.tar.gz');

    if (!isZip && !isTarGz) {
      throw new HttpException('Apenas arquivos .zip e .tar.gz são suportados', 400);
    }

    // O servidor deve estar offline para evitar corrupção
    try {
      const deployment = await this.k8sAppsApi.readNamespacedDeployment({ name: id, namespace: 'default' });
      if (deployment && deployment.spec?.replicas !== 0) {
        throw new HttpException('O servidor DEVE estar desligado (Stop) antes de subir o mundo!', 400);
      }
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      // se der 404 ignoramos (pode ser que o deploy ainda não exista mas o PVC sim)
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').toLowerCase();
    const jobName = `upload-${id}-${timestamp}`.substring(0, 63);

    const extractCmd = isZip
      ? `unzip -q ${file.path} -d /tmp/ext`
      : `tar -xzvf ${file.path} -C /tmp/ext`;

    const job: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: jobName, namespace: 'default' },
      spec: {
        ttlSecondsAfterFinished: 86400,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'extractor',
                image: 'alpine',
                command: ['/bin/sh', '-c'],
                args: [
                  `apk add unzip && mkdir -p /tmp/ext && mkdir -p /data/world && ` +
                  `${extractCmd} && rm -rf /data/world/* && ` +
                  `if [ -d /tmp/ext/world ]; then mv /tmp/ext/world/* /data/world/ 2>/dev/null || true; else mv /tmp/ext/* /data/world/ 2>/dev/null || true; fi && ` +
                  `rm -f ${file.path} && echo "Upload extraido com sucesso!"`
                ],
                volumeMounts: [
                  { name: 'data', mountPath: '/data' },
                  { name: 'uploads', mountPath: '/var/minekube/uploads' },
                ],
              },
            ],
            volumes: [
              { name: 'data', persistentVolumeClaim: { claimName: `${id}-pvc` } },
              { name: 'uploads', hostPath: { path: '/var/minekube/uploads', type: 'DirectoryOrCreate' } },
            ],
          },
        },
      },
    };

    try {
      await this.k8sBatch.createNamespacedJob({ namespace: 'default', body: job });
      this.logger.log(`Job de upload criado: ${jobName} para o server: ${id}`);
      return { success: true, message: 'Mundo enviado! A extração está ocorrendo de forma autônoma no cluster.' };
    } catch (e: any) {
      this.logger.error(`Erro ao criar Job de upload: ${e.message}`);
      throw new HttpException('Falha ao iniciar rotina de extração.', 500);
    }
  }
}
