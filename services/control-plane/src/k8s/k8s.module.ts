import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/app-config.module';
import { AppConfigService } from '@config/app-config.service';

import { KubernetesService } from './k8s.service';
import { KUBERNETES_DRIVER } from './k8s.interface';
import { RealKubernetesDriver } from './drivers/real-k8s.driver';
import { MockKubernetesDriver } from './drivers/mock-k8s.driver';

import { ConsoleModule } from '@console/console.module';

@Module({
  imports: [AppConfigModule, ConsoleModule],
  providers: [
    KubernetesService,
    {
      provide: KUBERNETES_DRIVER,
      useFactory: (configService: AppConfigService) => {
        if (configService.isTest || process.env.USE_MOCK_K8S === 'true') {
          return new MockKubernetesDriver();
        }
        return new RealKubernetesDriver(configService);
      },
      inject: [AppConfigService],
    },
  ],
  exports: [KubernetesService, KUBERNETES_DRIVER],
})
export class KubernetesModule {}
