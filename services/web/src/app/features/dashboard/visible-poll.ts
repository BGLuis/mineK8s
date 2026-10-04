import {
  EMPTY,
  Observable,
  distinctUntilChanged,
  fromEvent,
  map,
  startWith,
  switchMap,
  timer,
} from 'rxjs';

/**
 * Emits at once and then every `intervalMs` while the tab is visible. It stops while the tab is
 * hidden and emits again as soon as the tab comes back (RF-ARQ-27: no background polling).
 */
export function visiblePoll(intervalMs: number): Observable<number> {
  return fromEvent(document, 'visibilitychange').pipe(
    startWith(null),
    map(() => document.visibilityState === 'visible'),
    distinctUntilChanged(),
    switchMap((visible) => (visible ? timer(0, intervalMs) : EMPTY)),
  );
}
