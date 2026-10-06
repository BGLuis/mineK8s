import * as fs from 'node:fs';
import * as path from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';
import { MinecraftRconConsoleDriver } from '@console/minecraft-rcon-console.driver';

import {
  IKubernetesDriver,
  K8sDeploymentInfo,
  K8sJobInfo,
  KUBERNETES_DRIVER,
} from './k8s.interface';
import { ManifestBuilder } from './manifest-builder';
import { serverDataDirectory } from './server-data-volume';

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);

  constructor(
    @Inject(KUBERNETES_DRIVER)
    private readonly driver: IKubernetesDriver,
    private readonly configService: AppConfigService,
    @Optional()
    private readonly consoleDriver?: MinecraftRconConsoleDriver,
  ) {}

  async provisionServer(server: Server, settings?: MinecraftServerSettings): Promise<void> {
    this.logger.log(
      `Provisioning Kubernetes resources for server [${server.name}] (${server.subdomain})...`,
    );

    // 1. Own the server's directory before its PVC exists: local-path chmods the PVC directory to 700
    // when it provisions the volume, which would lock the control plane out unless it owns it.
    await fs.promises.mkdir(
      path.resolve(
        this.configService.storage.serversDataRoot,
        serverDataDirectory(server.subdomain),
      ),
      { recursive: true },
    );

    // 2. Create Persistent Volume Claim
    const pvcManifest = ManifestBuilder.buildPVC(server, this.configService);
    await this.driver.createPersistentVolumeClaim(pvcManifest);

    // 3. Create Service
    const serviceManifest = ManifestBuilder.buildService(server, this.configService);
    await this.driver.createService(serviceManifest);

    // 4. Create Deployment
    const deploymentManifest = ManifestBuilder.buildDeployment(
      server,
      settings,
      this.configService,
    );
    await this.driver.createDeployment(deploymentManifest);

    this.logger.log(`Successfully provisioned resources for [${server.subdomain}].`);
  }

  /** Rewrites the Deployment from the current server record; replicas follow server.state. */
  async applyDeployment(server: Server, settings?: MinecraftServerSettings): Promise<void> {
    this.logger.log(
      `Applying Deployment for [${server.subdomain}] with ${server.allocated_memory_mb} MiB heap...`,
    );
    await this.driver.replaceDeployment(
      ManifestBuilder.buildDeployment(server, settings, this.configService),
    );
  }

  /**
   * Rewrites the Deployment from the record before scaling, so a server picks up the jar, Java version and manifest
   * changes made since it last ran. Callers start only a server whose pod is down, so nothing running is restarted.
   */
  async startServer(server: Server): Promise<void> {
    this.logger.log(
      `Starting server [${server.subdomain}]: applying deployment and scaling to 1...`,
    );
    await this.driver.replaceDeployment(
      ManifestBuilder.buildDeployment(server, server.minecraft_settings, this.configService),
    );
    await this.driver.scaleDeployment(
      `mc-${server.subdomain}`,
      1,
      this.configService.kubernetes.namespace,
    );
  }

  async stopServer(server: Server): Promise<void> {
    const isMinecraft = !server.game_type || server.game_type.toUpperCase() === 'MINECRAFT';
    if (
      isMinecraft &&
      this.consoleDriver &&
      (server.state === 'READY' || server.state === 'STOPPING')
    ) {
      try {
        await this.consoleDriver.gracefulShutdown(server);
      } catch (err: any) {
        this.logger.warn(`Aviso no graceful shutdown de [${server.subdomain}]: ${err.message}`);
      }
    }

    this.logger.log(`Stopping server [${server.subdomain}]: scaling deployment to 0...`);
    await this.driver.scaleDeployment(
      `mc-${server.subdomain}`,
      0,
      this.configService.kubernetes.namespace,
    );
  }

  async restartServer(server: Server): Promise<void> {
    this.logger.log(
      `Restarting server [${server.subdomain}]: performing graceful stop and starting...`,
    );
    await this.stopServer(server);
    await this.startServer(server);
  }

  async deprovisionServer(server: Server): Promise<void> {
    this.logger.log(`Deprovisioning Kubernetes resources for server [${server.subdomain}]...`);
    await this.driver.deleteDeployment(
      `mc-${server.subdomain}`,
      this.configService.kubernetes.namespace,
    );
    await this.driver.deleteService(
      `mc-${server.subdomain}`,
      this.configService.kubernetes.namespace,
    );
    await this.driver.deletePersistentVolumeClaim(
      `data-${server.subdomain}`,
      this.configService.kubernetes.namespace,
    );
    this.logger.log(`Successfully deprovisioned resources for [${server.subdomain}].`);
  }

  async getServerDeployment(server: Server): Promise<K8sDeploymentInfo | null> {
    return this.driver.getDeployment(
      `mc-${server.subdomain}`,
      this.configService.kubernetes.namespace,
    );
  }

  async listDeployments(): Promise<K8sDeploymentInfo[]> {
    return this.driver.listDeployments(this.configService.kubernetes.namespace);
  }

  async createJob(manifest: any): Promise<void> {
    await this.driver.createJob(manifest);
  }

  async getJob(name: string, namespace?: string): Promise<K8sJobInfo | null> {
    return this.driver.getJob(name, namespace || this.configService.kubernetes.namespace);
  }

  async deleteJob(name: string, namespace?: string): Promise<void> {
    await this.driver.deleteJob(name, namespace || this.configService.kubernetes.namespace);
  }

  async waitForJobPodRunning(
    jobName: string,
    timeoutMs?: number,
    namespace?: string,
  ): Promise<boolean> {
    return this.driver.waitForJobPodRunning(
      jobName,
      timeoutMs,
      namespace || this.configService.kubernetes.namespace,
    );
  }

  async waitForJobCompletion(
    jobName: string,
    timeoutMs?: number,
    namespace?: string,
  ): Promise<boolean> {
    return this.driver.waitForJobCompletion(
      jobName,
      timeoutMs,
      namespace || this.configService.kubernetes.namespace,
    );
  }
}
