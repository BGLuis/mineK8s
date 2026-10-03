import { InjectionToken } from '@angular/core';
import { Socket, io } from 'socket.io-client';

export type SocketFactory = (namespace: string, getToken: () => string | null) => Socket;

/** Overridable in tests so no real network connection is opened. */
export const SOCKET_FACTORY = new InjectionToken<SocketFactory>('SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => (namespace, getToken) =>
    io(namespace, {
      autoConnect: false,
      // Callback form: reconnects pick up the current token.
      auth: (cb) => cb({ token: getToken() }),
    }),
});

/** Runs `onHidden` / `onVisible` as the tab loses/regains visibility (RF-ARQ-27). Returns a disposer. */
export function watchVisibility(onHidden: () => void, onVisible: () => void): () => void {
  const handler = () => (document.visibilityState === 'hidden' ? onHidden() : onVisible());
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
