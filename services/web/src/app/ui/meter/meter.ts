import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type MeterLevel = 'success' | 'warning' | 'danger';

export const METER_BLOCKS = 10;

/** <75 % success, 75-89 % warning, >=90 % danger (same thresholds as the disk alerts). */
export function meterLevel(percent: number): MeterLevel {
  if (percent >= 90) {
    return 'danger';
  }
  if (percent >= 75) {
    return 'warning';
  }
  return 'success';
}

export function meterFilledBlocks(percent: number): number {
  return Math.round((clamp(percent) / 100) * METER_BLOCKS);
}

function clamp(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}

const FILL_CLASSES: Record<MeterLevel, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
};

const TEXT_CLASSES: Record<MeterLevel, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
};

@Component({
  selector: 'mc-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="t-label-md mb-1 flex items-baseline justify-between gap-2">
      <span class="text-text-muted">{{ label() }}</span>
      <span class="t-body-strong" [class]="textClass()">{{ valueText() }}</span>
    </div>
    <div
      class="flex gap-1"
      role="meter"
      [attr.aria-label]="label()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="rounded()"
      [attr.aria-valuetext]="valueText()"
      [attr.data-level]="level()"
    >
      @for (block of blocks(); track $index) {
        <span
          class="h-[18px] w-[18px] shrink-0"
          [class]="block ? fillClass() : 'bg-bg-sunken'"
        ></span>
      }
    </div>
  `,
})
export class McMeter {
  readonly label = input.required<string>();
  /** Percentage, 0-100. */
  readonly value = input.required<number>();

  protected readonly rounded = computed(() => Math.round(clamp(this.value())));
  protected readonly level = computed(() => meterLevel(this.value()));
  protected readonly valueText = computed(() => `${this.rounded()} %`);
  protected readonly fillClass = computed(() => FILL_CLASSES[this.level()]);
  protected readonly textClass = computed(() => TEXT_CLASSES[this.level()]);
  protected readonly blocks = computed(() => {
    const filled = meterFilledBlocks(this.value());
    return Array.from({ length: METER_BLOCKS }, (_, i) => i < filled);
  });
}
