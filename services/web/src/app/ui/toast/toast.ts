import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { McIcon } from '../icon/icon';
import { ToastService, ToastTone } from './toast.service';

const DOT_CLASSES: Record<ToastTone, string> = {
  success: 'bg-status-success',
  info: 'bg-status-info',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
};

/** Renders the ToastService queue. Mount once, in the root component. */
@Component({
  selector: 'mc-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: {
    class:
      'pointer-events-none fixed right-4 bottom-20 left-4 z-50 flex flex-col items-end gap-3 md:bottom-4',
  },
  styles: `
    .toast {
      animation: mc-toast-in 120ms steps(3, end);
    }
  `,
  template: `
    @for (toast of service.toasts(); track toast.id) {
      <div
        class="toast bevel-panel pointer-events-auto flex w-full max-w-md items-start gap-3 bg-surface-hover p-3"
        [attr.role]="toast.tone === 'danger' ? 'alert' : 'status'"
      >
        <span class="mt-1.5 size-3 shrink-0" [class]="dots[toast.tone]" aria-hidden="true"></span>
        <p class="t-body-md min-w-0 flex-1 py-1">{{ toast.message }}</p>
        <button
          type="button"
          class="inline-flex size-10 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
          aria-label="Fechar notificação"
          (click)="service.dismiss(toast.id)"
        >
          <mc-icon name="close" [size]="16" />
        </button>
      </div>
    }
  `,
})
export class McToast {
  protected readonly service = inject(ToastService);
  protected readonly dots = DOT_CLASSES;
}
