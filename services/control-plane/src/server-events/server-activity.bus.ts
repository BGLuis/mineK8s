import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** What changed for a server, without a state transition: the panel reloads that part. */
export type ServerActivityKind = 'players' | 'backups' | 'stats';

export interface ServerActivityEvent {
  id: string;
  kind: ServerActivityKind;
}

/**
 * Where services announce that something the panel shows changed. It has no dependency on the
 * websocket layer, so a service can publish without importing the gateway (and its auth modules).
 */
@Injectable()
export class ServerActivityBus {
  private readonly subject = new Subject<ServerActivityEvent>();

  readonly events$: Observable<ServerActivityEvent> = this.subject.asObservable();

  publish(id: string, kind: ServerActivityKind): void {
    this.subject.next({ id, kind });
  }
}
