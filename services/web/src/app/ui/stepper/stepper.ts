import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { McIcon } from '../icon/icon';

@Component({
  selector: 'mc-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  template: `
    <ol class="flex flex-wrap gap-x-6 gap-y-2" [attr.aria-label]="label()">
      @for (step of steps(); track $index) {
        <li
          class="flex items-center gap-2"
          [attr.aria-current]="$index === current() ? 'step' : null"
        >
          <span
            class="t-button-sm inline-flex size-8 items-center justify-center border-2 border-border-strong"
            [class]="
              $index < current()
                ? 'bg-action-primary text-text-primary'
                : $index === current()
                  ? 'bg-action-warning text-text-inverse'
                  : 'bg-bg-sunken text-text-muted'
            "
          >
            @if ($index < current()) {
              <mc-icon name="check" [size]="16" />
              <span class="sr-only">Concluído:</span>
            } @else {
              {{ $index + 1 }}
            }
          </span>
          <span
            class="t-label-md"
            [class]="$index === current() ? 'text-text-primary' : 'text-text-muted'"
            >{{ step }}</span
          >
        </li>
      }
    </ol>
  `,
})
export class McStepper {
  readonly steps = input.required<string[]>();
  /** Zero-based index of the current step; earlier steps render as done. */
  readonly current = input(0);
  readonly label = input('Etapas');
}
