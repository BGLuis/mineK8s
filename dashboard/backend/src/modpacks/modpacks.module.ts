import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ModpacksController } from './modpacks.controller';
import { ModpacksService } from './modpacks.service';

@Module({
  imports: [HttpModule],
  controllers: [ModpacksController],
  providers: [ModpacksService]
})
export class ModpacksModule {}
