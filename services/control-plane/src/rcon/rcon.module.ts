import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/app-config.module';
import { MinecraftServerSettings } from '../database/entities/minecraft-server-settings.entity';
import { RconConnectionPool } from './pool/rcon-connection-pool';

@Module({
  imports: [AppConfigModule, TypeOrmModule.forFeature([MinecraftServerSettings])],
  providers: [RconConnectionPool],
  exports: [RconConnectionPool],
})
export class RconModule {}
