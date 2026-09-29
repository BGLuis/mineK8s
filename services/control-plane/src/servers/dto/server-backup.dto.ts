import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BackupStatus, BackupType } from '@database/entities/server-backup.entity';

export class ServerBackupDto {
  @ApiProperty({ description: 'ID único do backup (UUID)' })
  id: string;

  @ApiProperty({ description: 'ID do servidor proprietário do backup' })
  serverId: string;

  @ApiProperty({ description: 'Nome do arquivo compactado (.tar.gz)' })
  filename: string;

  @ApiProperty({ description: 'Tamanho total em bytes' })
  sizeBytes: number;

  @ApiProperty({ description: 'Hash criptográfico SHA-256' })
  sha256Checksum: string;

  @ApiProperty({ enum: BackupType, description: 'Tipo do backup' })
  backupType: BackupType;

  @ApiProperty({ enum: BackupStatus, description: 'Estado atual do backup' })
  status: BackupStatus;

  @ApiProperty({ description: 'Flag de proteção contra expurgo FIFO' })
  isProtected: boolean;

  @ApiProperty({ description: 'Versão do Minecraft no momento do backup' })
  minecraftVersion: string;

  @ApiPropertyOptional({ description: 'Versão do modpack, se aplicável' })
  modpackVersion?: string | null;

  @ApiProperty({ description: 'Data e hora da criação' })
  createdAt: Date;

  @ApiPropertyOptional({ description: 'Data de expiração da retenção/quarentena' })
  retentionExpiresAt?: Date | null;
}
