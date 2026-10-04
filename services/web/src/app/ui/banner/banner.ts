import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { McIcon } from '../icon/icon';

export type BannerTone = 'warning' | 'danger' | 'info';

const TONE_CLASSES: Record<BannerTone, string> = {
  warning: 'border-status-warning text-status-warning',
  danger: 'border-status-danger text-status-danger',
  info: 'border-status-info text-status-info',
};

@Component({
  selector: 'mc-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  template: `
    <div
      class="flex items-start gap-3 border-l-8 bg-bg-sunken p-3"
      [class]="toneClasses[tone()]"
      [attr.role]="tone() === 'danger' ? 'alert' : 'status'"
    >
      <span class="mt-1 size-3 shrink-0 bg-current" aria-hidden="true"></span>
      <div class="min-w-0 flex-1">
        <p class="t-label-md">{{ title() }}</p>
        <div class="t-body-md text-text-primary"><ng-content /></div>
      </div>
      @if (dismissible()) {
        <button
          type="button"
          class="inline-flex size-10 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
          aria-label="Dispensar aviso"
          (click)="dismissed.emit()"
        >
          <mc-icon name="close" [size]="16" />
        </button>
      }
    </div>
  `,
})
export class McBanner {
  readonly tone = input<BannerTone>('info');
  readonly title = input.required<string>();
  readonly dismissible = input(false);
  readonly dismissed = output<void>();

  protected readonly toneClasses = TONE_CLASSES;
}
