import { ChangeDetectionStrategy, Component } from '@angular/core';

import { BotPanel } from './bot-panel';
import { PosturePanel } from './posture-panel';
import { ReconcilerPanel } from './reconciler-panel';

@Component({
  selector: 'mc-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BotPanel, PosturePanel, ReconcilerPanel],
  template: `
    <div class="flex flex-col gap-8">
      <header>
        <h1 class="t-display-lg">Saúde do sistema</h1>
        <p class="t-body-lg mt-2 text-text-muted">
          Testes automáticos de login, segurança da rede e sincronização com o Kubernetes.
        </p>
      </header>

      <mc-bot-panel />

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <mc-posture-panel />
        <mc-reconciler-panel />
      </div>
    </div>
  `,
})
export class HealthPage {}
