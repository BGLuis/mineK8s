import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';

import { Server } from '../database/entities/server.entity';
import { ServerStateEvent, ServersStateGateway } from './servers-state.gateway';

const WATCHED_COLUMNS = ['state', 'is_maintenance'];

/**
 * Ponto único para todas as gravações de `Server`: o estado muda em dezenas de lugares
 * (serviços, reconciler, gateway-ipc), então escutamos o banco em vez de cada chamada.
 * Os eventos esperam o COMMIT, senão o painel poderia reler o estado antigo.
 */
@Injectable()
export class ServerStateSubscriber implements EntitySubscriberInterface<Server> {
  private readonly pending = new Map<QueryRunner, ServerStateEvent[]>();

  constructor(
    dataSource: DataSource,
    private readonly gateway: ServersStateGateway,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Server;
  }

  afterInsert(event: InsertEvent<Server>): void {
    if (event.entity) {
      this.record(event.queryRunner, this.toEvent(event.entity));
    }
  }

  afterUpdate(event: UpdateEvent<Server>): void {
    const changed = event.updatedColumns.some((column) => WATCHED_COLUMNS.includes(column.propertyName));
    if (!changed) {
      return;
    }
    const merged = { ...event.databaseEntity, ...event.entity } as Partial<Server>;
    if (merged.id) {
      this.record(event.queryRunner, this.toEvent(merged));
    }
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const events = this.pending.get(event.queryRunner) ?? [];
    this.pending.delete(event.queryRunner);
    for (const serverEvent of events) this.gateway.emitServerState(serverEvent);
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.pending.delete(event.queryRunner);
  }

  private record(queryRunner: QueryRunner | undefined, event: ServerStateEvent): void {
    if (!queryRunner?.isTransactionActive) {
      this.gateway.emitServerState(event);
      return;
    }
    const events = this.pending.get(queryRunner) ?? [];
    events.push(event);
    this.pending.set(queryRunner, events);
  }

  private toEvent(server: Partial<Server>): ServerStateEvent {
    return {
      id: server.id as string,
      status: server.state as string,
      is_maintenance: Boolean(server.is_maintenance),
    };
  }
}
