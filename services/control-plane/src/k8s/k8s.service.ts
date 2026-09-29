import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import { Server } from '@database/entities/server.entity';

import { IKubernetesDriver, K8sDeploymentInfo, KUBERNETES_DRIVER } from './k8s.interface';
import { ManifestBuilder } from './manifest-builder';

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);

  constructor(
    @Inject(KUBERNETES_DRIVER)
    private readonly driver: IKubernetesDriver,
    private readonly configService: AppConfigService,
  ) {}

  async provisionServer(
    server: Server,
    settings?: MinecraftServerSettings,
  ): Promise<void> {
    this.logger.log(`Provisioning Kubernetes resources for server [${server.name}] (${server.subdomain})...`);

    // 1. Create Persistent Volume Claim
    const pvcManifest = ManifestBuilder.buildPVC(server, this.configService);
    await this.driver.createPersistentVolumeClaim(pvcManifest);

    // 2. Create Service
    const serviceManifest = ManifestBuilder.buildService(server, this.configService);
    await this.driver.createService(serviceManifest);

    // 3. Create Deployment
    const deploymentManifest = ManifestBuilder.buildDeployment(
      server,
      settings,
      this.configService,
    );
    await this.driver.createDeployment(deploymentManifest);

    this.logger.log(`Successfully provisioned resources for [${server.subdomain}].`);
  }

  async startServer(server: Server): Promise<void> {
    this.logger.log(`Starting server [${server.subdomain}]: scaling deployment to 1...`);
    await this.driver.scaleDeployment(
      `mc-${server.subdomain}`,
      1,
      this.configService.kubernetes.namespace,
    );
  }

  async stopServer(server: Server): Promise<void> {
    this.logger.log(`Stopping server [${server.subdomain}]: scaling deployment to 0...`);
    await this.driver.scaleDeployment(
      `mc-${server.subdomain}`,
      0,
      this.configService.kubernetes.namespace,
    );
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
}
