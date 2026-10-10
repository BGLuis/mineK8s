import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '@config/app-config.service';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';
import { MinecraftRconConsoleDriver } from '@console/minecraft-rcon-console.driver';

import {
  IKubernetesDriver,
  K8sDeploymentInfo,
  K8sJobInfo,
  K8sPodStats,
  KUBERNETES_DRIVER,
} from './k8s.interface';
import { ManifestBuilder } from './manifest-builder';
import { serverWorkloadName } from './resource-names';
import { serverDataDirectory, serverDataVolumeName } from './server-data-volume';
import { isModpackServerType, writeServerProperties } from './server-properties';

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);

  constructor(
    @Inject(KUBERNETES_DRIVER)
    private readonly driver: IKubernetesDriver,
    private readonly configService: AppConfigService,
    @Optional()
    private readonly consoleDriver?: MinecraftRconConsoleDriver,
    @Optional()
    @InjectRepository(MinecraftServerSettings)
    private readonly settingsRepo?: Repository<MinecraftServerSettings>,
  ) {}

  async provisionServer(server: Server, settings?: MinecraftServerSettings): Promise<void> {
    this.logger.log(
      `Provisioning Kubernetes resources for server [${server.name}] (${server.subdomain})...`,
    );

    // 1. Own the server's directory before its PVC exists: local-path chmods the PVC directory to 700
    // when it provisions the volume, which would lock the control plane out unless it owns it.
    await fs.promises.mkdir(this.serverDataDir(server), { recursive: true });
    await this.writeServerProperties(server, settings);

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
    // Callers that loaded the server without the relation would otherwise start it on the defaults,
    // including the default RCON password the control plane then fails to authenticate with.
    const settings =
      server.minecraft_settings ??
      (await this.settingsRepo?.findOneBy({ server_id: server.id })) ??
      undefined;
    await this.writeServerProperties(server, settings);
    await this.driver.replaceDeployment(
      ManifestBuilder.buildDeployment(server, settings, this.configService),
    );
    await this.driver.scaleDeployment(
      serverWorkloadName(server.resource_name),
      1,
      this.configService.kubernetes.namespace,
    );
  }

  private serverDataDir(server: Server): string {
    return path.resolve(
      this.configService.storage.serversDataRoot,
      serverDataDirectory(server.resource_name),
    );
  }

  /** The server reads RCON and the Minecraft settings from server.properties, so it has to be written before every boot. */
  private async writeServerProperties(
    server: Server,
    settings?: MinecraftServerSettings,
  ): Promise<void> {
    if (server.game_type && server.game_type.toUpperCase() !== 'MINECRAFT') {
      return;
    }
    await writeServerProperties(this.serverDataDir(server), {
      settings,
      isModpack: isModpackServerType(server.server_type),
    });
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
      serverWorkloadName(server.resource_name),
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
      serverWorkloadName(server.resource_name),
      this.configService.kubernetes.namespace,
    );
    await this.driver.deleteService(
      serverWorkloadName(server.resource_name),
      this.configService.kubernetes.namespace,
    );
    await this.driver.deletePersistentVolumeClaim(
      serverDataVolumeName(server.resource_name),
      this.configService.kubernetes.namespace,
    );
    this.logger.log(`Successfully deprovisioned resources for [${server.subdomain}].`);
  }

  async getServerDeployment(server: Server): Promise<K8sDeploymentInfo | null> {
    return this.driver.getDeployment(
      serverWorkloadName(server.resource_name),
      this.configService.kubernetes.namespace,
    );
  }

  async streamServerLogs(server: Server): Promise<Readable | null> {
    return this.driver.streamPodLogs(
      serverWorkloadName(server.resource_name),
      this.configService.kubernetes.namespace,
    );
  }

  async getServerPodStats(server: Server): Promise<K8sPodStats | null> {
    return this.driver.getPodStats(
      serverWorkloadName(server.resource_name),
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
