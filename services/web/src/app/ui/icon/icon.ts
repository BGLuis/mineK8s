import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ICONS, IconDef, IconName } from './icon-registry';

/** Pixel icon drawn with `currentColor`. Decorative unless a `label` is given. */
@Component({
  selector: 'mc-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex shrink-0 align-middle',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="pixelated"
      fill="currentColor"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="'0 0 ' + def().viewBox + ' ' + def().viewBox"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      [attr.aria-hidden]="label() ? null : 'true'"
    >
      <path [attr.d]="def().path" [attr.transform]="transform()" />
    </svg>
  `,
})
export class McIcon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
  readonly label = input<string>();

  protected readonly def = computed<IconDef>(() => ICONS[this.name()]);
  protected readonly transform = computed(() => {
    const { rotate, viewBox } = this.def();
    return rotate ? `rotate(${rotate} ${viewBox / 2} ${viewBox / 2})` : null;
  });
}
