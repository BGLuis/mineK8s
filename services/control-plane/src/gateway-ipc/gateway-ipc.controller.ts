import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Observable } from 'rxjs';

import {
  Empty,
  ResolvePlayerRequest,
  ResolvePlayerResponse,
  RevokeSessionRequest,
  RevokeSessionResponse,
  RouteUpdateEvent,
  RoutingSnapshotResponse,
  SessionLifecycleEvent,
} from './gateway-ipc.interfaces';
import { GatewayIpcService } from './gateway-ipc.service';

@Controller()
export class GatewayIpcController {
  private readonly logger = new Logger(GatewayIpcController.name);

  constructor(private readonly ipcService: GatewayIpcService) {}

  /**
   * Sincronização inicial: Gateway busca snapshot completo de todas as rotas no boot (RF-GW-16).
   */
  @GrpcMethod('GatewayControlService', 'GetInitialRoutingSnapshot')
  async getInitialRoutingSnapshot(empty: Empty): Promise<RoutingSnapshotResponse> {
    return this.ipcService.getInitialRoutingSnapshot(empty);
  }

  /**
   * Streaming contínuo: Control Plane envia mutações de rotas e políticas para o Gateway.
   */
  @GrpcStreamMethod('GatewayControlService', 'StreamRouteUpdates')
  streamRouteUpdates(_empty: Empty): Observable<RouteUpdateEvent> {
    this.logger.log('Gateway L7 conectou ao stream contínuo de atualizações de rotas (StreamRouteUpdates)');
    return this.ipcService.getRouteUpdatesStream();
  }

  /**
   * Streaming contínuo: Gateway despacha eventos de conexão, desconexão e métricas para o Control Plane.
   */
  @GrpcStreamMethod('GatewayControlService', 'StreamSessionEvents')
  streamSessionEvents(messages: Observable<SessionLifecycleEvent>): Observable<Empty> {
    this.logger.log('Gateway L7 abriu stream de eventos de ciclo de vida de sessão (StreamSessionEvents)');
    messages.subscribe({
      next: (event) => this.ipcService.handleSessionEvent(event),
      error: (err) => this.logger.error(`Erro no stream de eventos de sessão: ${err?.message}`),
      complete: () => this.logger.log('Stream de eventos de sessão finalizado pelo Gateway'),
    });

    return new Observable((subscriber) => {
      subscriber.next({});
      subscriber.complete();
    });
  }

  /**
   * Comando RPC pontual: Control Plane solicita expulsão imediata de jogador (Smart Kick).
   */
  @GrpcMethod('GatewayControlService', 'RevokePlayerSession')
  async revokePlayerSession(req: RevokeSessionRequest): Promise<RevokeSessionResponse> {
    return this.ipcService.revokePlayerSession(req);
  }

  /**
   * Resolução de identidade pontual sob demanda.
   */
  @GrpcMethod('GatewayControlService', 'ResolvePlayerIdentity')
  async resolvePlayerIdentity(req: ResolvePlayerRequest): Promise<ResolvePlayerResponse> {
    return this.ipcService.resolvePlayerIdentity(req);
  }
}
