import { Module } from '@nestjs/common';
import { RconModule } from '../rcon/rcon.module';
import { CONSOLE_DRIVER_TOKEN } from './console-driver.interface';
import { MinecraftRconConsoleDriver } from './minecraft-rcon-console.driver';

@Module({
  imports: [RconModule],
  providers: [
    MinecraftRconConsoleDriver,
    {
      provide: CONSOLE_DRIVER_TOKEN,
      useExisting: MinecraftRconConsoleDriver,
    },
  ],
  exports: [CONSOLE_DRIVER_TOKEN, MinecraftRconConsoleDriver],
})
export class ConsoleModule {}
