import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { McIcon } from '../icon/icon';

let nextId = 0;

export type TextFieldType = 'text' | 'password' | 'email' | 'number' | 'search' | 'url';

@Component({
  selector: 'mc-text-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => McTextField), multi: true },
  ],
  styles: `
    .box:focus-within {
      outline: 4px solid var(--color-border-focus);
      outline-offset: -4px;
    }
    .box.is-disabled {
      box-shadow: none;
    }
  `,
  template: `
    <label class="t-label-md mb-1 block text-text-primary" [for]="id">{{ label() }}</label>
    <div
      class="box bevel-sunken flex h-12 items-center bg-surface-input"
      [class.border-status-danger]="!!errorText()"
      [class.is-disabled]="isDisabled()"
    >
      <input
        class="t-body-lg h-full min-w-0 flex-1 bg-transparent px-3 text-text-primary outline-none placeholder:text-text-disabled disabled:text-text-disabled"
        [id]="id"
        [type]="effectiveType()"
        [placeholder]="placeholder()"
        [disabled]="isDisabled()"
        [attr.autocomplete]="autocomplete() || null"
        [attr.maxlength]="maxlength()"
        [attr.name]="name() || null"
        [attr.inputmode]="inputmode() || null"
        [attr.aria-invalid]="errorText() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        [value]="value()"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      @if (type() === 'password') {
        <button
          type="button"
          class="inline-flex size-10 shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
          [attr.aria-label]="revealed() ? 'Ocultar valor' : 'Mostrar valor'"
          [attr.aria-pressed]="revealed()"
          [disabled]="isDisabled()"
          (click)="revealed.set(!revealed())"
        >
          <mc-icon [name]="revealed() ? 'eye-off' : 'eye'" [size]="24" />
        </button>
      }
    </div>
    @if (errorText()) {
      <p class="t-caption mt-1 text-status-danger" [id]="id + '-error'" role="alert">
        {{ errorText() }}
      </p>
    } @else if (helpText()) {
      <p class="t-caption mt-1 text-text-muted" [id]="id + '-help'">{{ helpText() }}</p>
    }
  `,
})
export class McTextField implements ControlValueAccessor {
  protected readonly id = `mc-text-field-${nextId++}`;

  readonly label = input.required<string>();
  readonly type = input<TextFieldType>('text');
  readonly placeholder = input('');
  readonly helpText = input('');
  readonly errorText = input('');
  readonly disabled = input(false);
  readonly autocomplete = input<string>();
  readonly maxlength = input<number>();
  readonly name = input<string>();
  readonly inputmode = input<string>();

  protected readonly value = signal('');
  protected readonly revealed = signal(false);
  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly effectiveType = computed(() =>
    this.type() === 'password' && this.revealed() ? 'text' : this.type(),
  );
  protected readonly describedBy = computed(() =>
    this.errorText() ? `${this.id}-error` : this.helpText() ? `${this.id}-help` : null,
  );

  private onChange: (value: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
