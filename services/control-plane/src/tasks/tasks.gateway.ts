import { Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { authenticateSocket, canAccessServer } from '../common/ws-auth';
import { UUID_PATTERN } from '../common/uuid';
import { ModpackTaskEntity } from '../database/entities/modpack-task.entity';
import { User } from '../database/entities/user.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { TaskExecutionService } from './task-execution.service';

export interface TaskProgressPayload {
  taskId: string;
  serverId: string;
  status: string;
  progressPercent: number;
  downloadedFiles: number;
  totalFiles: number;
  currentStep: string;
  speedBytesPerSec?: number;
  freezeDurationMs?: number;
  errorMessage?: string | null;
  error?: string | null;
}

export interface SubscribeToTaskDto {
  taskId: string;
}

@WebSocketGateway({
  namespace: '/ws/tasks',
})
export class TasksGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(TasksGateway.name);

  @WebSocketServer()
  server: any;

  constructor(
    @InjectRepository(ModpackTaskEntity)
    private readonly taskRepo: Repository<ModpackTaskEntity>,
    @InjectRepository(UserServerAccess)
    private readonly accessRepo: Repository<UserServerAccess>,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly trustedProxies: TrustedProxyService,
    @Optional() private readonly taskExecutionService?: TaskExecutionService,
  ) {}

  onModuleInit() {
    this.taskExecutionService?.onProgress((task) => this.emitTaskProgress(task));
  }

  async handleConnection(client: any) {
    try {
      const user = await authenticateSocket(
        client,
        this.authService,
        this.jwtService,
        this.trustedProxies,
      );
      if (!user) {
        this.logger.warn(
          `Conexão rejeitada no WebSocket de tarefas: credenciais ausentes ou inválidas`,
        );
        client.emit('unauthorized', { message: 'Missing or invalid credentials' });
        client.disconnect?.();
        return;
      }

      client.data = client.data || {};
      client.data.user = user;
      this.logger.debug(
        `Cliente conectado ao WebSocket de tarefas: ${client.id} (user ${user.id})`,
      );
    } catch (err) {
      this.logger.error(`Erro no handshake de /ws/tasks: ${(err as Error).message}`);
      client.disconnect?.();
    }
  }

  handleDisconnect(client: any) {
    this.logger.debug(`Cliente desconectado do WebSocket de tarefas: ${client.id}`);
  }

  @SubscribeMessage('subscribeToTask')
  async handleSubscribeToTask(
    @ConnectedSocket() client: any,
    @MessageBody() dto: SubscribeToTaskDto,
  ) {
    if (!dto?.taskId) {
      return { status: 'error', message: 'taskId is required' };
    }

    const inMemory = this.taskExecutionService?.getTask(dto.taskId);
    const user: User | undefined = client.data?.user;
    if (inMemory) {
      if (!(await canAccessServer(user, inMemory.serverId, this.accessRepo))) {
        return { status: 'error', message: `Task "${dto.taskId}" not found` };
      }
      const room = `task:${dto.taskId}`;
      client.join?.(room);
      this.logger.debug(`Cliente ${client.id} inscrito na sala da tarefa [${room}]`);
      client.emit?.('taskProgress', inMemory);
      return { status: 'subscribed', taskId: dto.taskId };
    }

    // Same answer for a missing task and for one the user may not see, so ids cannot be probed.
    const task = UUID_PATTERN.test(dto.taskId)
      ? await this.taskRepo.findOne({ where: { id: dto.taskId } })
      : null;
    if (!task || !(await canAccessServer(user, task.serverId, this.accessRepo))) {
      return { status: 'error', message: `Task "${dto.taskId}" not found` };
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
      this.logger.debug(
        `WebSocket server não inicializado, pulando emissão de progresso para task ${payload.taskId}`,
      );
      return;
    }

    const room = `task:${payload.taskId}`;
    this.server.to(room).emit('taskProgress', payload);
    this.logger.debug(
      `[RF-STO-18] Progresso emitido para ${room}: ${payload.progressPercent}% (${payload.currentStep})`,
    );
  }
}
