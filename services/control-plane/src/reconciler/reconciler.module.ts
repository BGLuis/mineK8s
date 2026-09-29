import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { KubernetesModule } from '@k8s/k8s.module';
import { AppConfigModule } from '@config/app-config.module';

import { ProbesModule } from '../probes/probes.module';
import { GatewayIpcModule } from '../gateway-ipc/gateway-ipc.module';

import { ReconcilerController } from './reconciler.controller';
import { ReconcilerService } from './reconciler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server]),
    KubernetesModule,
    AppConfigModule,
    ProbesModule,
    GatewayIpcModule,
  ],
  controllers: [ReconcilerController],
  providers: [ReconcilerService],
  exports: [ReconcilerService],
})
export class ReconcilerModule {}
