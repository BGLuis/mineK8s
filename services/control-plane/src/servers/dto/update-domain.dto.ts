import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDomainDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(63)
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: 'O domínio deve conter apenas letras minúsculas, números e hífens, sem hífen no início ou no fim',
  })
  domain: string;
}
