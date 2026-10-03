import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { McIcon } from '../../ui';

export interface ToggleOption {
  id: string;
  label: string;
}

export interface ToggleChange {
  id: string;
  selected: boolean;
}

/** Multi-select rendered as toggle buttons (aria-pressed), the pattern from the invite form in Figma. */
@Component({
  selector: 'mc-toggle-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McIcon],
  host: { class: 'block' },
  template: `
    <fieldset class="m-0 min-w-0 border-0 p-0">
      <legend class="t-label-md mb-2 p-0">{{ label() }}</legend>
      @if (options().length === 0) {
        <p class="t-body-md text-text-muted">{{ emptyText() }}</p>
      } @else {
        <div class="flex flex-wrap gap-x-2">
          @for (option of options(); track option.id) {
            <span class="has-drop inline-flex">
              <button
                type="button"
                class="t-button-sm inline-flex min-h-10 items-center gap-1 px-3"
                [class]="
                  isSelected(option.id)
                    ? 'bevel-light bg-action-light text-text-inverse'
                    : 'bevel-neutral bg-action-neutral text-text-primary hover:bg-surface-hover'
                "
                [attr.aria-pressed]="isSelected(option.id)"
                (click)="toggle(option.id)"
              >
                @if (isSelected(option.id)) {
                  <mc-icon name="check" [size]="16" />
                }
                {{ option.label }}
              </button>
            </span>
          }
        </div>
      }
    </fieldset>
  `,
})
export class ToggleGroup {
  readonly label = input.required<string>();
  readonly options = input.required<readonly ToggleOption[]>();
  readonly emptyText = input('Nada para escolher ainda.');
  /** The parent owns the selection, so a change that fails server-side never leaves the UI ahead of the data. */
  readonly selected = input<readonly string[]>([]);
  readonly toggled = output<ToggleChange>();

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    this.toggled.emit({ id, selected: !this.isSelected(id) });
  }
}
