import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Marks anything backed by MockApi, i.e. a feature the backend does not implement yet. */
@Component({
  selector: 'mc-no-api-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex', role: 'note' },
  template: `
    <span
      class="t-caption inline-flex items-center border-2 border-dashed border-status-warning px-1 text-status-warning"
      title="Este dado é simulado: o endpoint ainda não existe no backend."
    >
      SEM API{{ detail() ? ' · ' + detail() : '' }}
    </span>
  `,
})
export class McNoApiTag {
  readonly detail = input('');
}
