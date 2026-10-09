import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  output,
  untracked,
  viewChild,
} from '@angular/core';

import { McButton, ButtonVariant } from '../button/button';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let nextId = 0;

/**
 * Modal dialog. Focus starts on Cancel (the safe choice for destructive confirmations),
 * Tab is trapped inside, Esc cancels and focus returns to the trigger when it closes.
 */
@Component({
  selector: 'mc-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McButton],
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-40 flex items-center justify-center bg-surface-overlay/70 p-4"
        (keydown)="onKeydown($event)"
      >
        <div
          #dialog
          class="w-full max-w-lg border-4 border-border-strong bg-surface-default p-6 shadow-[0_8px_0_var(--bevel-panel-drop)]"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
        >
          <h2 class="t-title-sm mb-4" [id]="titleId">{{ title() }}</h2>
          <div class="t-body-md mb-6 text-text-muted"><ng-content /></div>
          <div class="flex flex-wrap justify-end gap-4">
            @if (!hideCancel()) {
              <mc-button (click)="cancel()">{{ cancelLabel() }}</mc-button>
            }
            <mc-button
              [variant]="confirmVariant()"
              [disabled]="confirmDisabled()"
              (click)="confirm()"
            >
              {{ confirmLabel() }}
            </mc-button>
          </div>
        </div>
      </div>
    }
  `,
})
export class McDialog {
  protected readonly titleId = `mc-dialog-title-${nextId++}`;

  readonly open = model(false);
  readonly title = input.required<string>();
  readonly confirmLabel = input('Confirmar');
  readonly cancelLabel = input('Cancelar');
  readonly confirmVariant = input<ButtonVariant>('danger');
  readonly confirmDisabled = input(false);
  readonly hideCancel = input(false);
  readonly closeOnConfirm = input(true);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.previouslyFocused = document.activeElement as HTMLElement | null;
          // The dialog node only exists after the next render.
          setTimeout(() =>
            this.dialog()?.nativeElement.querySelector<HTMLElement>('button')?.focus(),
          );
        });
      } else {
        untracked(() => {
          this.previouslyFocused?.focus();
          this.previouslyFocused = null;
        });
      }
    });
  }

  protected confirm(): void {
    this.confirmed.emit();
    if (this.closeOnConfirm()) {
      this.open.set(false);
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
    this.open.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(
      this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
