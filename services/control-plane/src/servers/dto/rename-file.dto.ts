import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RenameFileDto {
  @ApiProperty({ description: 'Existing path relative to server root', example: 'old_name.txt' })
  @IsNotEmpty()
  @IsString()
  oldPath: string;

  @ApiProperty({ description: 'New path relative to server root', example: 'new_name.txt' })
  @IsNotEmpty()
  @IsString()
  newPath: string;
}
