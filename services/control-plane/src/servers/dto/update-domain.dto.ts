import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDomainDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: 'Domain must contain only lowercase letters, numbers and hyphens, without a leading or trailing hyphen',
  })
  domain: string;
}
