import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { McMeter } from '../meter/meter';
import { McNoApiTag } from '../no-api-tag/no-api-tag';

@Component({
  selector: 'mc-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McMeter, McNoApiTag],
  host: { class: 'block h-full has-drop box-border' },
  template: `
    <div class="bevel-panel box-border flex h-full flex-col gap-2 bg-surface-default p-4">
      <mc-meter [label]="label()" [value]="value()" />
      @if (detail()) {
        <p class="t-body-md text-text-muted">{{ detail() }}</p>
      }
      @if (noApi()) {
        <mc-no-api-tag [detail]="noApiDetail()" />
      }
    </div>
  `,
})
export class McStatTile {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly detail = input('');
  /** Set when the value comes from MockApi. */
  readonly noApi = input(false);
  readonly noApiDetail = input('');
}
