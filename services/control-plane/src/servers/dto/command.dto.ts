import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CommandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  command: string;
}
