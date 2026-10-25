import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ConsoleModule } from '../console/console.module';
import { Server } from '../database/entities/server.entity';
import { ServerAuditLog } from '../database/entities/server-audit-log.entity';
import { User } from '../database/entities/user.entity';
import { KubernetesModule } from '../k8s/k8s.module';
import { LoggingModule } from '../logging/logging.module';
import { TerminalGateway } from './terminal.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server, ServerAuditLog, User]),
    ConsoleModule,
    LoggingModule,
    KubernetesModule,
    AuthModule,
  ],
  providers: [TerminalGateway],
  exports: [TerminalGateway],
})
export class TerminalModule {}
