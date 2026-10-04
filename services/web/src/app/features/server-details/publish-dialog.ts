import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PublishResponse } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { McDialog, ToastService } from '../../ui';
import { errorReason } from '../dashboard/server-lifecycle';
import { ServerDetailStore } from './server-detail.store';

/** PublishResponse as the control plane really sends it (servers.service.ts publishServer). */
type PublishResult = PublishResponse & { online_mode?: boolean; srv_record?: string };

type Step = 'confirm' | 'result' | null;

/** Publish / unpublish flow (screen 09). Open it with `open()` from the header. */
@Component({
  selector: 'mc-publish-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McDialog],
  template: `
    @if (step() === 'confirm') {
      @if (unpublishing()) {
        <mc-dialog
          [open]="true"
          [title]="'Despublicar &quot;' + serverName() + '&quot;?'"
          confirmLabel="Despublicar"
          confirmVariant="danger"
          (confirmed)="submit()"
          (cancelled)="close()"
        >
          Remove o endereço público e devolve o mundo à política privada: só convidados da VPN
          continuam entrando. Quem estiver conectado pela internet será desconectado.
        </mc-dialog>
      } @else {
        <mc-dialog
          [open]="true"
          [title]="'Publicar &quot;' + serverName() + '&quot; na internet?'"
          confirmLabel="Publicar"
          confirmVariant="warning"
          (confirmed)="submit()"
          (cancelled)="close()"
        >
          Qualquer pessoa com Minecraft original poderá encontrar o endereço. Para proteger o mundo,
          o servidor passa a exigir contas oficiais: online-mode=true é forçado e jogadores piratas
          deixam de entrar. Convidados da VPN continuam entrando normalmente.
          @if (store.accessPolicy() === null) {
            <p class="t-caption mt-3">
              Este mundo já está publicado?
              <button type="button" class="underline" (click)="forceUnpublish.set(true)">
                Despublicar
              </button>
            </p>
          }
        </mc-dialog>
      }
    } @else if (step() === 'result') {
      <mc-dialog
        [open]="true"
        [title]="'&quot;' + serverName() + '&quot; está na internet'"
        confirmLabel="Copiar registro"
        confirmVariant="info"
        cancelLabel="Fechar"
        (confirmed)="copyRecord()"
        (cancelled)="close()"
      >
        <p>O mundo agora aceita contas oficiais pelo endereço público.</p>
        <dl class="mt-4 space-y-3">
          <div>
            <dt class="t-caption uppercase">Subdomínio</dt>
            <dd class="t-body-strong text-text-primary break-all">{{ result()?.subdomain }}</dd>
          </div>
          @if (result()?.srv_record; as record) {
            <div>
              <dt class="t-caption uppercase">Registro SRV</dt>
              <dd class="t-body-strong text-text-primary break-all">{{ record }}</dd>
            </div>
          }
        </dl>
      </mc-dialog>
    }
  `,
})
export class McPublishDialog {
  private readonly api = inject(ServersApi);
  protected readonly store = inject(ServerDetailStore);
  private readonly toast = inject(ToastService);

  readonly serverName = input.required<string>();

  protected readonly step = signal<Step>(null);
  protected readonly result = signal<PublishResult | null>(null);
  readonly busy = signal(false);
  private trigger: HTMLElement | null = null;

  /** GET /api/servers/:id does not report access_policy, so after a reload "published" is unknown. */
  protected readonly forceUnpublish = signal(false);

  protected unpublishing(): boolean {
    return this.forceUnpublish() || this.store.accessPolicy() === 'INTERNET';
  }

  open(): void {
    this.trigger = document.activeElement as HTMLElement | null;
    this.forceUnpublish.set(false);
    this.step.set('confirm');
  }

  protected close(): void {
    this.step.set(null);
    setTimeout(() => this.trigger?.focus());
  }

  protected async submit(): Promise<void> {
    const id = this.store.serverId();
    if (!id) {
      return;
    }
    const unpublishing = this.unpublishing();
    this.step.set(null);
    this.busy.set(true);
    try {
      const response = await firstValueFrom(
        unpublishing ? this.api.unpublish(id) : this.api.publish(id),
      );
      this.store.accessPolicy.set(response.access_policy);
      this.store.refresh();
      if (unpublishing) {
        this.toast.success(`"${this.serverName()}" não está mais na internet.`);
        this.close();
      } else {
        this.result.set(response as PublishResult);
        this.step.set('result');
      }
    } catch (error) {
      this.toast.error(
        `Não foi possível ${unpublishing ? 'despublicar' : 'publicar'} "${this.serverName()}". ${errorReason(error)}`,
      );
      this.close();
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyRecord(): Promise<void> {
    const result = this.result();
    const text = result?.srv_record ?? result?.subdomain ?? '';
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Registro copiado.');
    } catch {
      // The Clipboard API needs a secure context; the panel is often served over plain HTTP on the LAN.
      this.toast.error(`Não foi possível copiar automaticamente. Copie daqui: ${text}`);
    }
    this.close();
  }
}
