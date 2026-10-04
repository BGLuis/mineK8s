import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

let nextId = 0;

/** On/off row with a pixel switch. Switch semantics, 56 x 40 px touch target. */
@Component({
  selector: 'mc-setting-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="t-label-md" [id]="id + '-label'">{{ label() }}</p>
        <p class="t-caption text-text-muted" [id]="id + '-hint'"><ng-content /></p>
      </div>
      <button
        type="button"
        role="switch"
        class="bevel-sunken flex h-10 w-14 shrink-0 cursor-pointer items-center p-1"
        [class]="checked() ? 'justify-end bg-action-primary' : 'justify-start bg-surface-input'"
        [attr.aria-checked]="checked()"
        [attr.aria-labelledby]="id + '-label'"
        [attr.aria-describedby]="id + '-hint'"
        [disabled]="disabled()"
        (click)="checked.set(!checked())"
      >
        <span class="block h-6 w-5 border-2 border-border-strong bg-action-light"></span>
      </button>
    </div>
  `,
})
export class McSettingSwitch {
  protected readonly id = `mc-setting-switch-${nextId++}`;

  readonly label = input.required<string>();
  readonly disabled = input(false);
  readonly checked = model(false);
}
