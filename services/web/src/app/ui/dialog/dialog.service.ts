import { Injectable, signal } from '@angular/core';

import { ButtonVariant } from '../button/button';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  hideCancel?: boolean;
}

export interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/** Promise-based confirmation, rendered by `mc-dialog-host` in the root component. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly _pending = signal<PendingConfirm | null>(null);
  readonly pending = this._pending.asReadonly();

  confirm(options: ConfirmOptions): Promise<boolean> {
    this._pending()?.resolve(false);
    return new Promise((resolve) => this._pending.set({ ...options, resolve }));
  }

  settle(confirmed: boolean): void {
    const current = this._pending();
    this._pending.set(null);
    current?.resolve(confirmed);
  }
}
