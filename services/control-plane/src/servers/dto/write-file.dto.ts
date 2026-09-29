import { IsNotEmpty, IsString } from 'class-validator';

export class WriteFileDto {
  @IsString()
  content: string;
}
