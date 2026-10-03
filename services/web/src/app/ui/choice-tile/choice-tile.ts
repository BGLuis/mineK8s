import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { McIcon } from '../icon/icon';
import { IconName } from '../icon/icon-registry';

/** Selectable block with radio semantics: tiles that share a `name` behave as one radio group. */
@Component({
  selector: 'mc-choice-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block has-drop' },
  styles: `
    label:has(input:focus-visible) {
      outline: 2px solid var(--color-border-focus);
      outline-offset: 2px;
    }
  `,
  template: `
    <label
      class="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 text-center"
      [class]="
        checked()
          ? 'border-selected bg-surface-default p-2.5'
          : 'bevel-neutral bg-surface-default p-3 hover:bg-surface-hover'
      "
    >
      <input
        class="sr-only"
        type="radio"
        [name]="name()"
        [value]="value()"
        [checked]="checked()"
        [disabled]="disabled()"
        (change)="chosen.emit(value())"
      />
      @if (icon(); as iconName) {
        <mc-icon [name]="iconName" [size]="32" />
      }
      <span class="t-label-md">{{ label() }}</span>
      @if (description()) {
        <span class="t-caption text-text-muted">{{ description() }}</span>
      }
    </label>
  `,
})
export class McChoiceTile {
  readonly name = input.required<string>();
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly description = input('');
  readonly icon = input<IconName>();
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly chosen = output<string>();
}
