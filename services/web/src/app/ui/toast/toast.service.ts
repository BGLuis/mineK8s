import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
  readonly sticky: boolean;
}

export const TOAST_DURATION_MS = 5000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private readonly _toasts = signal<readonly Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  /** Errors stay until dismissed so they are not missed; everything else fades after 5 s. */
  show(tone: ToastTone, message: string): number {
    const toast: Toast = { id: this.nextId++, tone, message, sticky: tone === 'danger' };
    this._toasts.update((list) => [...list, toast]);
    if (!toast.sticky) {
      setTimeout(() => this.dismiss(toast.id), TOAST_DURATION_MS);
    }
    return toast.id;
  }

  success(message: string): number {
    return this.show('success', message);
  }

  info(message: string): number {
    return this.show('info', message);
  }

  warning(message: string): number {
    return this.show('warning', message);
  }

  error(message: string): number {
    return this.show('danger', message);
  }

  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((toast) => toast.id !== id));
  }
}
