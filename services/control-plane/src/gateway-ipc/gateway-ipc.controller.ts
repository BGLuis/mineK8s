import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Observable, endWith, ignoreElements, tap } from 'rxjs';

import {
  Empty,
  GatewayCommand,
  GatewayCommandResult,
  ResolvePlayerRequest,
  ResolvePlayerResponse,
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
   * Requisição simples com resposta em stream é `@GrpcMethod`; `@GrpcStreamMethod` seria para stream de entrada
   * e deixaria o Gateway recebendo UNIMPLEMENTED.
   */
  @GrpcMethod('GatewayControlService', 'StreamRouteUpdates')
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

    // O RPC é "stream -> Empty": a resposta única só pode sair quando o Gateway encerra o seu fluxo.
    // Responder antes encerraria a chamada e descartaria todos os eventos seguintes.
    return messages.pipe(
      tap({
        next: (event) =>
          void this.ipcService
            .handleSessionEvent(event)
            .catch((err) => this.logger.error(`Falha ao processar evento de sessão: ${err?.message}`)),
        error: (err) => {
          this.logger.error(`Erro no stream de eventos de sessão: ${err?.message}`);
          this.ipcService.handleSessionStreamClosed();
        },
        complete: () => {
          this.logger.log('Stream de eventos de sessão finalizado pelo Gateway');
          this.ipcService.handleSessionStreamClosed();
        },
      }),
      ignoreElements(),
      endWith({} as Empty),
    );
  }

  /**
   * Canal de comandos Control Plane -> Gateway (Smart Kick, ban de rede): o Gateway abre o stream e devolve
   * o resultado de cada comando, que o serviço correlaciona pelo command_id.
   */
  @GrpcStreamMethod('GatewayControlService', 'StreamCommands')
  streamCommands(results: Observable<GatewayCommandResult>): Observable<GatewayCommand> {
    this.logger.log('Gateway L7 abriu o canal de comandos (StreamCommands)');
    return this.ipcService.openCommandStream(results);
  }

  /**
   * Resolução de identidade pontual sob demanda.
   */
  @GrpcMethod('GatewayControlService', 'ResolvePlayerIdentity')
  async resolvePlayerIdentity(req: ResolvePlayerRequest): Promise<ResolvePlayerResponse> {
    return this.ipcService.resolvePlayerIdentity(req);
  }
}
