import {
  Observable,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  merge,
  of,
  share,
  startWith,
  switchMap,
} from 'rxjs';

import {
  ServerActivityEvent,
  ServerSocketSignal,
  ServerStateEvent,
} from '../../core/realtime/servers-socket';
import { visiblePoll } from './visible-poll';

/** Bursts of transitions (STARTING then READY, several servers) collapse into one reload. */
const PUSH_DEBOUNCE_MS = 150;

/**
 * Emits when the screen should reload: on every accepted `serverState` push, on every accepted
 * `serverActivity` push (players, backups or stats changed; ignored unless `acceptActivity` is
 * given), once as soon as the socket connects (to catch up on anything missed), and, only while
 * the socket is down, every `fallbackMs` like before the socket existed.
 */
export function liveRefresh(
  signals$: Observable<ServerSocketSignal>,
  fallbackMs: number,
  accept: (event: ServerStateEvent) => boolean = () => true,
  acceptActivity: (event: ServerActivityEvent) => boolean = () => false,
): Observable<void> {
  const signals = signals$.pipe(share());

  const pushes = signals.pipe(
    filter((signal) =>
      signal.type === 'state'
        ? accept(signal.event)
        : signal.type === 'activity' && acceptActivity(signal.event),
    ),
    debounceTime(PUSH_DEBOUNCE_MS),
    map(() => undefined),
  );

  const connection = signals.pipe(
    filter((signal) => signal.type === 'connected' || signal.type === 'disconnected'),
    map((signal) => signal.type === 'connected'),
    startWith(false),
    distinctUntilChanged(),
    switchMap((connected) =>
      connected ? of(undefined) : visiblePoll(fallbackMs).pipe(map(() => undefined)),
    ),
  );

  return merge(pushes, connection);
}
