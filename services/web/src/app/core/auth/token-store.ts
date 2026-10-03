import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'mc.access_token';

/** Holds the JWT in memory and mirrors it to sessionStorage so a reload keeps the session. */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly _token = signal<string | null>(readStored());
  readonly token = this._token.asReadonly();

  set(token: string): void {
    this._token.set(token);
    writeStored(token);
  }

  clear(): void {
    this._token.set(null);
    writeStored(null);
  }
}

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be blocked (private mode); the in-memory token still works.
  }
}
