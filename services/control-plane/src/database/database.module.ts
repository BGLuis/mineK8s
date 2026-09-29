import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import {
  Group,
  Invite,
  InviteGroup,
  InviteServer,
  MinecraftServerSettings,
  Server,
  ServerAuditLog,
  ServerGroup,
  TailscaleDevice,
  User,
  UserGroup,
  UserServerAccess,
  ServerBackupEntity,
  ModpackTaskEntity,
} from './entities';
import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';

const entities = [
  Server,
  MinecraftServerSettings,
  User,
  TailscaleDevice,
  Group,
  UserGroup,
  ServerGroup,
  UserServerAccess,
  Invite,
  InviteGroup,
  InviteServer,
  ServerAuditLog,
  ServerBackupEntity,
  ModpackTaskEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: 'postgres',
        host: config.database.host,
        port: config.database.port,
        username: config.database.user,
        password: config.database.pass,
        database: config.database.name,
        ssl: config.database.ssl,
        synchronize: config.database.synchronize,
        logging: config.database.logging,
        entities,
        migrations: [InitialSchema1710000000000],
        migrationsRun: !config.isProduction, // In non-production, auto-run migrations on boot
        extra: {
          max: config.database.poolSize,
        },
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
