import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthService } from '../auth/auth.service';
import { authenticateSocket, canAccessServer } from '../common/ws-auth';
import { JwtService } from '../auth/jwt.service';
import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { Server } from '../database/entities/server.entity';
import { ServerAuditLog } from '../database/entities/server-audit-log.entity';
import { User } from '../database/entities/user.entity';
import { CONSOLE_DRIVER_TOKEN, ConsoleDriver } from '../console/console-driver.interface';
import { KubernetesService } from '../k8s/k8s.service';
import { K8sLogStreamerService } from '../logging/k8s-log-streamer.service';

export interface JoinTerminalDto {
  serverId: string;
}

export interface SendCommandDto {
  serverId: string;
  command: string;
}

const MAX_COMMANDS_PER_WINDOW = 5;
const COMMAND_WINDOW_MS = 1000;

@WebSocketGateway({
  namespace: '/terminal',
})
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);

  @WebSocketServer()
  server: any;

  // Gerencia subscrições ativas de streaming para salas WebSocket
  private readonly subscribedRooms = new Set<string>();

  constructor(
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(ServerAuditLog)
    private readonly auditRepo: Repository<ServerAuditLog>,
    @Inject(CONSOLE_DRIVER_TOKEN)
    private readonly consoleDriver: ConsoleDriver,
    private readonly logStreamer: K8sLogStreamerService,
    private readonly k8sService: KubernetesService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly trustedProxies: TrustedProxyService,
  ) {}

  /**
   * Handshake de autenticação WebSocket (RF-RCON-14, Guarda L-01).
   */
  async handleConnection(client: any) {
    try {
      const user = await this.authenticateClient(client);
      if (!user) {
        this.logger.warn(`Conexão WebSocket rejeitada: Missing or invalid credentials`);
        client.emit('unauthorized', { message: 'Missing or invalid credentials' });
        client.disconnect?.();
        return;
      }

      client.data = client.data || {};
      client.data.user = user;
      this.logger.log(
        `Cliente WebSocket conectado: ${user.minecraft_nick || user.email || user.id} (role: ${user.role})`,
      );
    } catch (err) {
      this.logger.error(`Erro no handshake de WebSocket: ${(err as Error).message}`);
      client.disconnect?.();
    }
  }

  handleDisconnect(client: any) {
    const user = client.data?.user;
    if (user) {
      this.logger.log(`Cliente desconectado: ${user.id}`);
    }
  }

  /**
   * Evento: join_terminal (RF-RCON-13)
   * Valida permissão, insere cliente na sala do servidor e retorna histórico inicial.
   */
  @SubscribeMessage('join_terminal')
  async handleJoinTerminal(@ConnectedSocket() client: any, @MessageBody() data: JoinTerminalDto) {
    const { serverId } = data;
    const user: User | undefined = client.data?.user;

    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new WsException(`Server ${serverId} not found`);
    }

    const hasAccess = await this.checkUserAccess(user, serverId);
    if (!hasAccess) {
      client.emit('error', { message: 'Unauthorized access to the terminal of this server' });
      return;
    }

    // Insere cliente na sala Socket.IO
    client.join?.(serverId);

    // Garante que o stream de deltas esteja configurado para a sala
    this.ensureRoomLogStream(server);

    // Retorna histórico inicial bootstrap (log_history)
    const buffer = this.logStreamer.getBuffer(serverId);
    const history = buffer.getHistory();

    // Emitted here and not returned: Nest re-emits a returned { event, data } to the client, which
    // would deliver it twice.
    client.emit('log_history', { serverId, lines: history });
  }

  /**
   * Evento: send_command (RF-RCON-13, RF-RCON-12)
   * Executa comando via ConsoleDriver e persiste em server_audit_logs.
   */
  @SubscribeMessage('send_command')
  async handleSendCommand(@ConnectedSocket() client: any, @MessageBody() data: SendCommandDto) {
    const { serverId, command } = data;
    const user: User | undefined = client.data?.user;

    if (!this.tryConsumeCommandSlot(client)) {
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: `Limit of ${MAX_COMMANDS_PER_WINDOW} commands per second exceeded. Wait a moment.`,
      });
      return;
    }

    const server = await this.serverRepo.findOne({
      where: { id: serverId },
      relations: {
        minecraft_settings: true,
      },
    });
    if (!server) {
      throw new WsException(`Server ${serverId} not found`);
    }

    const hasAccess = await this.checkUserAccess(user, serverId);
    if (!hasAccess) {
      client.emit('error', { message: 'Unauthorized to send commands to this server' });
      return;
    }

    const startTime = Date.now();
    let output = '';
    let isError = false;

    try {
      output = await this.consoleDriver.sendCommand(server, command);
    } catch (err) {
      output = (err as Error).message;
      isError = true;
    }
    const durationMs = Date.now() - startTime;

    // Persistência em server_audit_logs (Critério de Aceite Issue #65)
    await this.auditRepo.save({
      server_id: server.id,
      user_id: user?.id ?? null,
      command,
      execution_source: 'TERMINAL_SESSION',
      ip_address: client.handshake?.address || null,
      response: output ? output.substring(0, 500) : null,
      executed_at: new Date(),
    });

    const responseData = {
      serverId,
      command,
      output,
      durationMs,
      error: isError,
      source: 'rcon' as const,
    };

    client.emit('command_output', responseData);
  }

  /** Janela deslizante por socket (SRS 03): comandos recusados não ocupam vaga. */
  private tryConsumeCommandSlot(client: any): boolean {
    client.data = client.data || {};
    const now = Date.now();
    const recent: number[] = (client.data.commandTimestamps || []).filter(
      (timestamp: number) => now - timestamp < COMMAND_WINDOW_MS,
    );
    if (recent.length >= MAX_COMMANDS_PER_WINDOW) {
      client.data.commandTimestamps = recent;
      return false;
    }
    recent.push(now);
    client.data.commandTimestamps = recent;
    return true;
  }

  private checkUserAccess(user: User | undefined, _serverId?: string): Promise<boolean> {
    return canAccessServer(user);
  }

  private ensureRoomLogStream(server: Server): void {
    if (!this.subscribedRooms.has(server.id)) {
      this.subscribedRooms.add(server.id);

      // Conecta pipeline de deltas para emitir para todos na sala (log_delta)
      this.logStreamer.subscribeToDeltas(server.id, (entry) => {
        this.server?.to?.(server.id)?.emit('log_delta', {
          serverId: server.id,
          entry,
        });
      });
    }

    // Inicia (ou retoma, se parou por falta de clientes) o stream k8s contínuo do pod
    const hasViewers = () => (this.server?.sockets?.adapter?.rooms?.get(server.id)?.size ?? 0) > 0;
    this.logStreamer
      .attachServerStream(
        server.id,
        server.resource_name,
        () => this.k8sService.streamServerLogs(server),
        {
          shouldRetry: hasViewers,
        },
      )
      .catch((err) => {
        this.logger.warn(
          `Stream inicial de logs k8s para ${server.subdomain} pendente: ${err.message}`,
        );
      });
  }

  private authenticateClient(client: any): Promise<User | null> {
    return authenticateSocket(client, this.authService, this.jwtService, this.trustedProxies);
  }
}
