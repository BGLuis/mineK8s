import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { McDialog } from './dialog';
import { DialogService } from './dialog.service';

@Component({
  selector: 'mc-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McDialog],
  template: `
    @if (service.pending(); as request) {
      <mc-dialog
        [open]="true"
        [title]="request.title"
        [confirmLabel]="request.confirmLabel ?? 'Confirmar'"
        [cancelLabel]="request.cancelLabel ?? 'Cancelar'"
        [confirmVariant]="request.confirmVariant ?? 'danger'"
        (confirmed)="service.settle(true)"
        (cancelled)="service.settle(false)"
      >
        {{ request.message }}
      </mc-dialog>
    }
  `,
})
export class McDialogHost {
  protected readonly service = inject(DialogService);
}
