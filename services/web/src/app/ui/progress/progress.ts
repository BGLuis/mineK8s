import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ProgressTone = 'xp' | 'info' | 'danger';

const TONE_FILL: Record<ProgressTone, string> = {
  xp: 'bg-status-success',
  info: 'bg-status-info',
  danger: 'bg-status-danger',
};

/** XP-style bar split into 10 segments by a mask over a continuous fill. */
@Component({
  selector: 'mc-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .mask {
      background: repeating-linear-gradient(
        90deg,
        transparent 0,
        transparent calc(10% - 2px),
        var(--color-surface-default) calc(10% - 2px),
        var(--color-surface-default) 10%
      );
    }
  `,
  template: `
    <div class="t-body-md mb-1 flex items-baseline justify-between gap-2">
      <span class="text-text-muted">{{ step() }}</span>
      <span class="text-text-primary">{{ rounded() }} %</span>
    </div>
    <div
      class="relative h-3 bg-bg-sunken"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="rounded()"
      [attr.aria-label]="step() || 'Progresso'"
    >
      <div
        class="absolute inset-y-0 left-0"
        [class]="fillClass()"
        [style.width.%]="rounded()"
      ></div>
      <div class="mask absolute inset-0" aria-hidden="true"></div>
    </div>
  `,
})
export class McProgress {
  readonly percent = input.required<number>();
  readonly tone = input<ProgressTone>('xp');
  readonly step = input('');

  protected readonly rounded = computed(() =>
    Math.round(Math.min(100, Math.max(0, this.percent()))),
  );
  protected readonly fillClass = computed(() => TONE_FILL[this.tone()]);
}
