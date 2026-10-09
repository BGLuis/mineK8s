import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RestoreBackupDto {
  @ApiPropertyOptional({
    description: 'ID de rastreamento da tarefa para o TasksGateway (/ws/tasks)',
  })
  @IsOptional()
  @IsString()
  taskId?: string;
}
