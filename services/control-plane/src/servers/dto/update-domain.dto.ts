import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDomainDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: 'domain must be a valid RFC 1123 label (lowercase alphanumeric and hyphens, no adjacent hyphens)',
  })
  domain: string;
}
