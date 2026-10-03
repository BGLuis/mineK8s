import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

export const RAM_MIN_MB = 1024;
export const RAM_MAX_MB = 65536;
export const RAM_STEP_MB = 512;
/** Fixed 1.5 GiB on top of the JVM heap for metaspace, native memory and the OS (C-17). */
export const RAM_OVERHEAD_MB = 1536;

export function containerMemoryMb(heapMb: number): number {
  return heapMb + RAM_OVERHEAD_MB;
}

export function formatGib(megabytes: number): string {
  const gib = (megabytes / 1024).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${gib} GiB`;
}

@Component({
  selector: 'mc-ram-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => McRamSlider), multi: true },
  ],
  styles: `
    input[type='range'] {
      appearance: none;
      height: 16px;
      background: var(--color-bg-sunken);
      border: 2px solid var(--color-border-strong);
    }
    input[type='range']::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 32px;
      background: var(--color-action-light);
      border: 2px solid var(--color-border-strong);
      box-shadow: inset 2px 2px 0 var(--bevel-light-hi);
    }
    input[type='range']::-moz-range-thumb {
      width: 12px;
      height: 28px;
      border-radius: 0;
      background: var(--color-action-light);
      border: 2px solid var(--color-border-strong);
    }
    input[type='range']:disabled::-webkit-slider-thumb {
      background: var(--color-surface-hover);
    }
  `,
  template: `
    <label class="t-label-md mb-1 flex items-baseline justify-between gap-2" [for]="id">
      <span>Memória do servidor (heap)</span>
      <span class="text-status-success">{{ heapText() }}</span>
    </label>
    <input
      class="w-full"
      type="range"
      [id]="id"
      [min]="min"
      [max]="max"
      [step]="step"
      [value]="value()"
      [disabled]="disabled()"
      [attr.aria-valuetext]="heapText()"
      (input)="onInput($event)"
      (blur)="onTouched()"
    />
    <p class="t-caption mt-2 text-text-muted" aria-live="polite">
      Contêiner: {{ heapText() }} heap + 1,5 GiB de margem =
      <strong class="text-text-primary">{{ containerText() }}</strong>
    </p>
  `,
})
export class McRamSlider implements ControlValueAccessor {
  protected readonly id = `mc-ram-slider-${nextId++}`;
  protected readonly min = RAM_MIN_MB;
  protected readonly max = RAM_MAX_MB;
  protected readonly step = RAM_STEP_MB;

  protected readonly value = signal(4096);
  private readonly formDisabled = signal(false);
  readonly disabledInput = input(false, { alias: 'disabled' });
  protected readonly disabled = computed(() => this.disabledInput() || this.formDisabled());

  protected readonly heapText = computed(() => formatGib(this.value()));
  protected readonly containerText = computed(() => formatGib(containerMemoryMb(this.value())));

  private onChange: (value: number) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  protected onInput(event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    this.value.set(next);
    this.onChange(next);
  }

  writeValue(value: number | null): void {
    this.value.set(clampMb(value ?? RAM_MIN_MB));
  }

  registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}

function clampMb(value: number): number {
  return Math.min(RAM_MAX_MB, Math.max(RAM_MIN_MB, value));
}
