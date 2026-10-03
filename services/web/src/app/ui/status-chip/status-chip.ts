import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ServerState } from '../../core/api/models';

export type StatusChipState = ServerState | 'MAINTENANCE';
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

export interface StatusChipConfig {
  readonly label: string;
  readonly tone: StatusTone;
  /** Transitional states blink so "starting" is never mistaken for "stopped". */
  readonly blink: boolean;
}

export const STATUS_CHIP_CONFIG: Record<StatusChipState, StatusChipConfig> = {
  PROVISIONING: { label: 'PROVISIONANDO', tone: 'info', blink: false },
  STARTING: { label: 'INICIANDO', tone: 'warning', blink: true },
  READY: { label: 'ONLINE', tone: 'success', blink: false },
  STOPPING: { label: 'PARANDO', tone: 'warning', blink: true },
  STOPPED: { label: 'HIBERNANDO', tone: 'neutral', blink: false },
  UPDATING: { label: 'ATUALIZANDO', tone: 'info', blink: true },
  CRASHED: { label: 'TRAVOU', tone: 'danger', blink: false },
  FAILED: { label: 'FALHOU', tone: 'danger', blink: false },
  MAINTENANCE: { label: 'MANUTENÇÃO', tone: 'accent', blink: false },
};

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'text-status-success border-status-success',
  warning: 'text-status-warning border-status-warning',
  danger: 'text-status-danger border-status-danger',
  info: 'text-status-info border-status-info',
  accent: 'text-status-accent border-status-accent',
  neutral: 'text-status-neutral border-status-neutral',
};

export function statusChipConfig(state: StatusChipState): StatusChipConfig {
  return STATUS_CHIP_CONFIG[state];
}

export function statusToneClasses(tone: StatusTone): string {
  return TONE_CLASSES[tone];
}

@Component({
  selector: 'mc-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  styles: `
    .blink {
      animation: mc-blink 1s steps(1, end) infinite;
    }
  `,
  template: `
    <span
      class="t-button-sm inline-flex items-center gap-2 border-2 bg-bg-sunken px-2 py-0.5"
      [class]="toneClasses()"
      [attr.data-tone]="config().tone"
      [attr.data-state]="state()"
    >
      <span
        class="size-2 shrink-0 bg-current"
        [class.blink]="config().blink"
        aria-hidden="true"
      ></span>
      {{ config().label }}
    </span>
  `,
})
export class McStatusChip {
  readonly state = input.required<StatusChipState>();

  protected readonly config = computed(() => statusChipConfig(this.state()));
  protected readonly toneClasses = computed(() => statusToneClasses(this.config().tone));
}
