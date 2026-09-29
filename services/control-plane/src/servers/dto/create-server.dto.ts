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

export enum ServerType {
  PAPER = 'PAPER',
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
    message: 'subdomain must be a valid RFC 1123 label (lowercase alphanumeric and hyphens, no adjacent hyphens)',
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
  @ValidateNested()
  @Type(() => MinecraftSettingsDto)
  minecraft_settings?: MinecraftSettingsDto;
}
