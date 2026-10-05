import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

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
  CasObjectEntity,
} from './entities';
import { migrations } from './migrations';
import { runMigrationsExclusively } from './run-migrations';

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
  CasObjectEntity,
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
        migrations,
        extra: {
          max: config.database.poolSize,
        },
      }),
      // Every environment applies pending migrations on boot; a failed one aborts the boot, so the
      // previous pod keeps serving instead of new code running against the old schema.
      dataSourceFactory: async (options?: DataSourceOptions) => {
        // Synchronize is deferred to keep TypeORM's own order (migrations first) when DB_SYNCHRONIZE is on.
        const dataSource = await new DataSource({
          ...(options as DataSourceOptions),
          synchronize: false,
        }).initialize();
        try {
          const applied = await runMigrationsExclusively(dataSource);
          if (applied.length > 0) {
            new Logger('DatabaseModule').log(
              `Applied migrations: ${applied.map((migration) => migration.name).join(', ')}`,
            );
          }
          if (options?.synchronize) {
            await dataSource.synchronize();
          }
          return dataSource;
        } catch (error) {
          // @nestjs/typeorm retries a failed factory; each attempt would otherwise leak a pool.
          await dataSource.destroy();
          throw error;
        }
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
