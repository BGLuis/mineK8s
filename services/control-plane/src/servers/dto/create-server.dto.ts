import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { SERVER_LANGUAGES, ServerLanguage } from '../server-language';

export enum ServerType {
  PAPER = 'PAPER',
  PURPUR = 'PURPUR',
  VANILLA = 'VANILLA',
  FABRIC = 'FABRIC',
  FORGE = 'FORGE',
  NEOFORGE = 'NEOFORGE',
}

export class MinecraftSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  motd?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  max_players?: number;

  @IsOptional()
  @IsString()
  @IsIn(['peaceful', 'easy', 'normal', 'hard'])
  difficulty?: string;

  @IsOptional()
  @IsString()
  @IsIn(['survival', 'creative', 'adventure', 'spectator'])
  gamemode?: string;

  @IsOptional()
  @IsBoolean()
  hardcore?: boolean;

  @IsOptional()
  @IsBoolean()
  pvp?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  spawn_protection?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(32)
  view_distance?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(32)
  simulation_distance?: number;

  @IsOptional()
  @IsString()
  @MinLength(6)
  rcon_password?: string;

  @IsOptional()
  @IsBoolean()
  enforce_secure_chat?: boolean;

  @IsOptional()
  @IsBoolean()
  online_mode?: boolean;

  @IsOptional()
  @IsIn(SERVER_LANGUAGES)
  language?: ServerLanguage;
}

export class CreateServerDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message:
      'Subdomain must contain only lowercase letters, numbers and hyphens, without a leading or trailing hyphen',
  })
  subdomain: string;

  /**
   * RF-MG-02: Game Type discriminator ('minecraft', 'terraria', etc.)
   */
  @IsOptional()
  @IsString()
  game_type?: string = 'minecraft';

  @IsOptional()
  @IsString()
  @IsIn(['sni-shared-port', 'dedicated-port'])
  routing_model?: string = 'sni-shared-port';

  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(65535)
  allocated_port?: number;

  @IsOptional()
  @IsEnum(ServerType)
  server_type?: ServerType = ServerType.PAPER;

  @IsOptional()
  @IsString()
  game_version?: string = '1.20.4';

  @IsOptional()
  @IsString()
  modpack_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(65536)
  allocated_memory_mb?: number = 4096;

  @IsOptional()
  @IsBoolean()
  auto_wake?: boolean = true;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  sleep_timeout_minutes?: number = 15;

  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'GROUP', 'INDIVIDUAL', 'MAINTENANCE', 'INTERNET'])
  access_policy?: 'PUBLIC' | 'GROUP' | 'INDIVIDUAL' | 'MAINTENANCE' | 'INTERNET' = 'GROUP';

  @IsOptional()
  @ValidateNested()
  @Type(() => MinecraftSettingsDto)
  minecraft_settings?: MinecraftSettingsDto;
}
