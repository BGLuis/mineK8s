import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Server } from '@database/entities/server.entity';
import { KubernetesModule } from '@k8s/k8s.module';
import { AppConfigModule } from '@config/app-config.module';

import { ReconcilerController } from './reconciler.controller';
import { ReconcilerService } from './reconciler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server]),
    KubernetesModule,
    AppConfigModule,
  ],
  controllers: [ReconcilerController],
  providers: [ReconcilerService],
  exports: [ReconcilerService],
})
export class ReconcilerModule {}
