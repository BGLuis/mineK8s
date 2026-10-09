import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { McIcon } from '../icon/icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

let nextSelectId = 0;

/** Retro Minecraft styled dropdown select with custom bevel and chevron. */
@Component({
  selector: 'mc-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  template: `
    @if (label()) {
      <label class="t-label-md mb-1 block" [for]="id">{{ label() }}</label>
    }
    <div class="relative">
      <select
        [id]="id"
        class="bevel-sunken t-body-lg h-12 w-full appearance-none bg-surface-input px-3 pr-12 text-text-primary disabled:text-text-disabled"
        [disabled]="disabled()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [value]="value()"
        (change)="onChange($event)"
      >
        @if (placeholder()) {
          <option value="" disabled [selected]="!value()">{{ placeholder() }}</option>
        }
        @for (opt of options(); track opt.value) {
          <option [value]="opt.value" [disabled]="opt.disabled" [selected]="value() === opt.value">
            {{ opt.label }}
          </option>
        }
      </select>
      <mc-icon
        class="pointer-events-none absolute top-3 right-3 text-text-muted"
        name="chevron-down"
        [size]="24"
      />
    </div>
    @if (hint()) {
      <p class="t-caption mt-1 text-text-muted">{{ hint() }}</p>
    }
  `,
})
export class McSelect {
  protected readonly id = `mc-select-${nextSelectId++}`;

  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly hint = input<string>('');
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly options = input<readonly SelectOption[]>([]);
  readonly value = model<string>('');

  protected onChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.value.set(val);
  }
}
