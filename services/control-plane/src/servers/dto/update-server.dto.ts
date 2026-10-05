import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Campos editáveis depois da criação; mesmos limites do CreateServerDto. INTERNET só entra por POST /:id/publish. */
export class UpdateServerDto {
  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(65536)
  allocated_memory_mb?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  sleep_timeout_minutes?: number;

  @IsOptional()
  @IsBoolean()
  auto_wake?: boolean;

  @IsOptional()
  @IsBoolean()
  is_maintenance?: boolean;

  @IsOptional()
  @IsIn(['PUBLIC', 'GROUP', 'INDIVIDUAL', 'MAINTENANCE'], {
    message: 'Access policy must be PUBLIC, GROUP, INDIVIDUAL or MAINTENANCE',
  })
  access_policy?: 'PUBLIC' | 'GROUP' | 'INDIVIDUAL' | 'MAINTENANCE';
}
