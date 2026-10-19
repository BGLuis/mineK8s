import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isValidTimeZone', async: false })
export class IsValidTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(tz: unknown): boolean {
    if (typeof tz !== 'string') return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'backup_timezone must be a valid IANA time zone identifier';
  }
}

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
  @IsInt()
  @Min(0)
  @Max(1440)
  stop_warning_minutes?: number;

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

  @IsOptional()
  @IsIn(['OFF', 'INTERVAL', 'DAILY'], {
    message: 'Backup schedule mode must be OFF, INTERVAL or DAILY',
  })
  backup_schedule_mode?: 'OFF' | 'INTERVAL' | 'DAILY';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  backup_interval_hours?: number;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  backup_daily_time?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  backup_window_start?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  backup_window_end?: string;

  @IsOptional()
  @IsString()
  @Validate(IsValidTimeZoneConstraint)
  backup_timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  backup_retention_count?: number;
}
