import { Injectable, Optional } from '@nestjs/common';

import { ServerActivityBus } from '../server-events/server-activity.bus';

import { SessionLifecycleEvent } from './gateway-ipc.interfaces';

export interface PlayerSession {
  sessionId: string;
  nick: string;
  ip: string;
  connectedAt: Date;
}

/**
 * Sessões ativas por servidor, mantidas em memória a partir dos eventos CONNECTED/DISCONNECTED do Gateway.
 *
 * O Gateway é a fonte da verdade: se o stream cai, o estado aqui fica desconhecido e é descartado
 * (`clearAll`); ao reconectar, o Gateway deve reenviar CONNECTED para cada sessão que ainda está aberta.
 */
@Injectable()
export class PlayerSessionsService {
  private readonly byServer = new Map<string, Map<string, PlayerSession>>();

  constructor(@Optional() private readonly activity?: ServerActivityBus) {}

  connected(event: SessionLifecycleEvent): void {
    const sessions = this.byServer.get(event.server_id) ?? new Map<string, PlayerSession>();
    // Um nick só pode ter uma sessão por servidor (o Gateway despeja a anterior, RF-GW-13).
    for (const [id, session] of sessions) {
      if (session.nick === event.minecraft_nick && id !== event.session_id) {
        sessions.delete(id);
      }
    }
    sessions.set(event.session_id, {
      sessionId: event.session_id,
      nick: event.minecraft_nick,
      ip: event.client_ip,
      connectedAt: event.timestamp_epoch_ms > 0 ? new Date(event.timestamp_epoch_ms) : new Date(),
    });
    this.byServer.set(event.server_id, sessions);
    this.activity?.publish(event.server_id, 'players');
  }

  disconnected(event: SessionLifecycleEvent): void {
    const sessions = this.byServer.get(event.server_id);
    if (!sessions) {
      return;
    }
    sessions.delete(event.session_id);
    if (sessions.size === 0) {
      this.byServer.delete(event.server_id);
    }
    this.activity?.publish(event.server_id, 'players');
  }

  list(serverId: string): PlayerSession[] {
    return [...(this.byServer.get(serverId)?.values() ?? [])].sort(
      (a, b) => a.connectedAt.getTime() - b.connectedAt.getTime(),
    );
  }

  count(serverId: string): number {
    return this.byServer.get(serverId)?.size ?? 0;
  }

  clearAll(): void {
    const serverIds = [...this.byServer.keys()];
    this.byServer.clear();
    for (const serverId of serverIds) {
      this.activity?.publish(serverId, 'players');
    }
  }
}
