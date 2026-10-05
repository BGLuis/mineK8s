import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { McIcon } from '../icon/icon';
import { IconName } from '../icon/icon-registry';

export type ButtonVariant =
  | 'neutral'
  | 'light'
  | 'primary'
  | 'danger'
  | 'info'
  | 'warning'
  | 'accent';
export type ButtonSize = 'md' | 'sm';

/** Light and warning backgrounds are bright, so they take inverse (black) text for contrast. */
const INVERSE_TEXT: readonly ButtonVariant[] = ['light', 'warning'];

export function buttonTextClass(variant: ButtonVariant): 'text-text-inverse' | 'text-text-primary' {
  return INVERSE_TEXT.includes(variant) ? 'text-text-inverse' : 'text-text-primary';
}

const BACKGROUND: Record<ButtonVariant, string> = {
  neutral: 'bevel-neutral bg-action-neutral',
  light: 'bevel-light bg-action-light',
  primary: 'bevel-primary bg-action-primary',
  danger: 'bevel-danger bg-action-danger',
  info: 'bevel-info bg-action-info',
  warning: 'bevel-warning bg-action-warning',
  accent: 'bevel-accent bg-action-accent',
};

@Component({
  selector: 'mc-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: {
    '[class]': '"has-drop " + (block() ? "flex" : "inline-flex")',
    '[style.pointer-events]': 'disabled() ? "none" : null',
  },
  styles: `
    .mc-btn {
      border: 2px solid var(--color-border-strong);
      transition: none;
    }
    .mc-btn:active:not(:disabled) {
      transform: translateY(4px);
      box-shadow: inset 4px 4px 0 var(--bevel-pressed);
    }
    .mc-btn:disabled {
      box-shadow: inset 4px 4px 0 var(--bevel-pressed);
    }
  `,
  template: `
    <button
      class="mc-btn inline-flex w-full cursor-pointer items-center justify-center gap-2 px-6 disabled:cursor-not-allowed disabled:bg-surface-default disabled:text-text-disabled"
      [class]="classes()"
      [type]="type()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel() || null"
    >
      @if (icon(); as iconName) {
        <mc-icon [name]="iconName" [size]="size() === 'md' ? 24 : 16" />
      }
      <ng-content />
    </button>
  `,
})
export class McButton {
  readonly variant = input<ButtonVariant>('neutral');
  readonly size = input<ButtonSize>('md');
  readonly disabled = input(false);
  readonly icon = input<IconName>();
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly block = input(false);
  /** Required for icon-only buttons. */
  readonly ariaLabel = input<string>();

  protected readonly classes = computed(() => {
    const variant = this.variant();
    const height = this.size() === 'md' ? 'h-14 t-button-md' : 'h-10 t-button-sm';
    return `${BACKGROUND[variant]} ${buttonTextClass(variant)} ${height}`;
  });
}
