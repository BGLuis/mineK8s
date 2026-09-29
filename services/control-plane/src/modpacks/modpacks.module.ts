import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasObjectEntity } from '@database/entities/cas-object.entity';
import { ModpackTaskEntity } from '@database/entities/modpack-task.entity';
import { Server } from '@database/entities/server.entity';
import { AppConfigModule } from '@config/app-config.module';
import { TasksModule } from '../tasks/tasks.module';
import { CasStorageService } from './cas/cas-storage.service';
import { ModrinthResolverService } from './resolvers/modrinth-resolver.service';
import { CurseForgeResolverService } from './resolvers/curseforge-resolver.service';
import { ModpackConfigInjectorService } from './config/modpack-config-injector.service';
import { ModpackInstallerService } from './modpack-installer.service';
import { ModpacksController } from './modpacks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CasObjectEntity, ModpackTaskEntity, Server]),
    AppConfigModule,
    TasksModule,
  ],
  controllers: [ModpacksController],
  providers: [
    CasStorageService,
    ModrinthResolverService,
    CurseForgeResolverService,
    ModpackConfigInjectorService,
    ModpackInstallerService,
  ],
  exports: [
    CasStorageService,
    ModrinthResolverService,
    CurseForgeResolverService,
    ModpackConfigInjectorService,
    ModpackInstallerService,
  ],
})
export class ModpacksModule {}
