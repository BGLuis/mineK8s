import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

export interface TaskProgressPayload {
  taskId: string;
  serverId: string;
  status: string;
  progressPercent: number;
  downloadedFiles: number;
  totalFiles: number;
  currentStep: string;
  speedBytesPerSec?: number;
}

export interface SubscribeToTaskDto {
  taskId: string;
}

@WebSocketGateway({
  namespace: '/ws/tasks',
  cors: {
    origin: '*',
  },
})
export class TasksGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TasksGateway.name);

  @WebSocketServer()
  server: any;

  handleConnection(client: any) {
    this.logger.debug(`Cliente conectado ao WebSocket de tarefas: ${client.id}`);
  }

  handleDisconnect(client: any) {
    this.logger.debug(`Cliente desconectado do WebSocket de tarefas: ${client.id}`);
  }

  @SubscribeMessage('subscribeToTask')
  handleSubscribeToTask(
    @ConnectedSocket() client: any,
    @MessageBody() dto: SubscribeToTaskDto,
  ) {
    if (!dto?.taskId) {
      return { status: 'error', message: 'taskId is required' };
    }

    const room = `task:${dto.taskId}`;
    client.join(room);
    this.logger.debug(`Cliente ${client.id} inscrito na sala da tarefa [${room}]`);

    return { status: 'subscribed', taskId: dto.taskId };
  }

  /**
   * Emite evento de progresso em tempo real para os clientes conectados à sala da tarefa (RF-STO-18).
   */
  public emitTaskProgress(payload: TaskProgressPayload): void {
    if (!this.server) {
      this.logger.debug(`WebSocket server não inicializado, pulando emissão de progresso para task ${payload.taskId}`);
      return;
    }

    const room = `task:${payload.taskId}`;
    this.server.to(room).emit('taskProgress', payload);
    this.logger.debug(
      `[RF-STO-18] Progresso emitido para ${room}: ${payload.progressPercent}% (${payload.currentStep})`,
    );
  }
}
