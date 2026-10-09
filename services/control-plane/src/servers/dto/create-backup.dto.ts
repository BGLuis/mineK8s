import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBackupDto {
  @ApiPropertyOptional({
    description:
      'Tipo do backup a ser executado: HOT (quente via RCON + CoW) ou COLD (frio com réplicas=0)',
    enum: ['HOT', 'COLD'],
    default: 'HOT',
  })
  @IsOptional()
  @IsEnum(['HOT', 'COLD'])
  type?: 'HOT' | 'COLD';

  @ApiPropertyOptional({
    description: 'ID de rastreamento da tarefa para o TasksGateway (/ws/tasks)',
  })
  @IsOptional()
  @IsString()
  taskId?: string;
}
