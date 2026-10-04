import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'mc-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full has-drop box-border' },
  template: `
    <section
      class="bevel-panel box-border h-full bg-surface-default p-4 md:p-6"
      [attr.aria-label]="title() || null"
    >
      @if (title()) {
        <header class="mb-4 flex items-center justify-between gap-4">
          <h2 class="t-title-sm">{{ title() }}</h2>
          <ng-content select="[panelActions]" />
        </header>
      }
      <ng-content />
    </section>
  `,
})
export class McPanel {
  readonly title = input('');
}
