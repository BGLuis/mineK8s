import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDirectoryDto {
  @ApiProperty({ description: 'Parent path relative to server root', default: '', required: false })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiProperty({ description: 'Name of the directory to create', example: 'plugins' })
  @IsNotEmpty()
  @IsString()
  name: string;
}
