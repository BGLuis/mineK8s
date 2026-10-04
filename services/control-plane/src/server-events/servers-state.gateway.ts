import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { AuthService } from '../auth/auth.service';
import { JwtService } from '../auth/jwt.service';
import { TrustedProxyService } from '../auth/trusted-proxy.service';
import { authenticateSocket } from '../common/ws-auth';

export interface ServerStateEvent {
  id: string;
  status: string;
  is_maintenance: boolean;
}

/**
 * Namespace `/ws/servers` (RF-ARQ-27): empurra transições de estado dos servidores para o painel,
 * que é só de administradores, no lugar de polling.
 */
@WebSocketGateway({
  namespace: '/ws/servers',
  cors: {
    origin: '*',
  },
})
export class ServersStateGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ServersStateGateway.name);

  @WebSocketServer()
  server: any;

  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly trustedProxies: TrustedProxyService,
  ) {}

  async handleConnection(client: any): Promise<void> {
    try {
      const user = await authenticateSocket(
        client,
        this.authService,
        this.jwtService,
        this.trustedProxies,
      );
      if (user?.role !== 'ADMIN') {
        client.emit('unauthorized', { message: 'Missing or invalid credentials' });
        client.disconnect?.();
      }
    } catch (err) {
      this.logger.error(`Erro no handshake de /ws/servers: ${(err as Error).message}`);
      client.disconnect?.();
    }
  }

  emitServerState(event: ServerStateEvent): void {
    this.server?.emit('serverState', event);
  }
}
