import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { PostureAuditReport, TailscaleApi } from '../../core/api';
import { McBanner, McButton, McIcon, McPanel } from '../../ui';
import { formatRelative } from '../access/format';
import { apiErrorMessage } from '../join/api-error';
import {
  POLICY_SOURCE_LABEL,
  POSTURE_VIEW,
  SEVERITY_VIEW,
  TONE_BORDER,
  TONE_TEXT,
  postureChecks,
} from './health-views';

@Component({
  selector: 'mc-posture-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McPanel, McBanner, McButton, McIcon],
  template: `
    <mc-panel title="Auditoria da rede (ACL)">
      <mc-button panelActions size="sm" [disabled]="loading()" (click)="load(true)">
        {{ loading() && refreshing() ? 'Reavaliando…' : 'Reavaliar' }}
      </mc-button>

      @if (error()) {
        <mc-banner tone="danger" title="Não foi possível auditar a rede">
          {{ error() }}
          <div class="mt-2">
            <mc-button size="sm" (click)="load(false)">Tentar de novo</mc-button>
          </div>
        </mc-banner>
      } @else if (report(); as audit) {
        <div class="flex flex-col gap-3" [attr.aria-busy]="loading()">
          <span
            class="t-label-md inline-flex w-fit items-center gap-2 border-2 px-3 py-1"
            [class]="toneBorder[view().tone]"
          >
            <span class="size-2 bg-current" aria-hidden="true"></span>
            {{ view().label }}
          </span>
          <ul class="flex flex-col gap-1">
            @for (check of checks(); track check.text) {
              <li
                class="t-body-md flex items-start gap-2"
                [class]="check.ok ? toneText.success : toneText.danger"
              >
                <mc-icon [name]="check.ok ? 'check' : 'close'" [size]="16" />
                {{ check.text }}
              </li>
            }
            @for (finding of audit.findings; track $index) {
              <li
                class="t-body-md flex items-start gap-2"
                [class]="toneText[severity(finding.severity).tone]"
              >
                <mc-icon name="warning" [size]="16" />
                <span>
                  <span class="t-body-strong">{{ severity(finding.severity).label }}:</span>
                  {{ finding.description }}
                </span>
              </li>
            }
          </ul>
          <p class="t-caption text-text-muted">
            Fonte: {{ source() }} · {{ checkedAt() }}
            @if (!audit.isTailnetLiveChecked) {
              · rede ao vivo não consultada
            }
          </p>
        </div>
      } @else {
        <div class="flex flex-col gap-2" role="status" aria-label="Carregando auditoria">
          <div class="h-8 w-48 animate-pulse bg-surface-hover"></div>
          <div class="h-5 animate-pulse bg-surface-hover"></div>
          <div class="h-5 animate-pulse bg-surface-hover"></div>
        </div>
      }
    </mc-panel>
  `,
})
export class PosturePanel {
  private readonly tailscale = inject(TailscaleApi);

  protected readonly report = signal<PostureAuditReport | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly refreshing = signal(false);

  protected readonly toneText = TONE_TEXT;
  protected readonly toneBorder = TONE_BORDER;
  protected readonly view = computed(() => POSTURE_VIEW[this.report()?.status ?? 'ERROR']);
  protected readonly checks = computed(() => {
    const report = this.report();
    return report ? postureChecks(report) : [];
  });
  protected readonly source = computed(
    () => POLICY_SOURCE_LABEL[this.report()?.policySource ?? 'memory'],
  );
  protected readonly checkedAt = computed(() => {
    const timestamp = this.report()?.timestamp;
    return timestamp ? `verificado ${formatRelative(timestamp)}` : '';
  });

  constructor() {
    this.load(false);
  }

  protected severity(severity: keyof typeof SEVERITY_VIEW) {
    return SEVERITY_VIEW[severity];
  }

  /** `refresh` makes the backend re-read the live policy instead of serving its cached audit. */
  protected load(refresh: boolean): void {
    this.loading.set(true);
    this.refreshing.set(refresh);
    this.error.set('');
    this.tailscale.postureAudit(refresh).subscribe({
      next: (report) => {
        this.loading.set(false);
        this.report.set(report);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(error, 'Tente de novo em instantes.'));
      },
    });
  }
}
