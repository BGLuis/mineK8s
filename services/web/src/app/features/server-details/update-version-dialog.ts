import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';

import { MinecraftVersionItem, UpdateVersionResponse } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { McDialog, McVersionSelector, ToastService } from '../../ui';
import { errorReason } from '../dashboard/server-lifecycle';
import { ServerDetailStore } from './server-detail.store';

type Step = 'confirm' | 'result' | null;

function compareVersions(from: string, to: string): number {
  const partsA = from.split(/[-.]/).map((p) => {
    const n = Number(p);
    return Number.isNaN(n) ? p : n;
  });
  const partsB = to.split(/[-.]/).map((p) => {
    const n = Number(p);
    return Number.isNaN(n) ? p : n;
  });
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const pA = partsA[i];
    const pB = partsB[i];
    if (pA === undefined) return -1;
    if (pB === undefined) return 1;
    if (typeof pA === 'number' && typeof pB === 'number') {
      if (pA !== pB) return pA - pB;
    } else {
      const cmp = String(pA).localeCompare(String(pB));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

@Component({
  selector: 'mc-update-version-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McDialog, McVersionSelector],
  template: `
    @if (step() === 'confirm') {
      <mc-dialog
        [open]="true"
        [title]="'Atualizar versão de &quot;' + serverName() + '&quot;'"
        [confirmLabel]="isDowngrade() ? 'Fazer downgrade' : 'Atualizar versão'"
        [confirmVariant]="isDowngrade() ? 'danger' : 'warning'"
        [confirmDisabled]="!canConfirm()"
        cancelLabel="Cancelar"
        (confirmed)="submit()"
        (cancelled)="close()"
      >
        <div class="space-y-4">
          <p class="t-caption text-text-muted">
            Versão atual: <strong class="text-text-primary">{{ currentVersion() }}</strong> ({{ serverType() }})
          </p>

          <mc-version-selector
            label="Nova versão do Minecraft"
            [serverType]="serverType()"
            [versions]="versionsList().length > 0 ? versionsList() : null"
            [(value)]="targetVersion"
          />

          @if (isDowngrade()) {
            <div class="border-2 border-status-danger bg-status-danger/10 p-3 space-y-3" role="alert">
              <p class="t-body-md text-status-danger font-medium">
                Voltar para uma versão anterior pode corromper o mundo. Um backup pre-update será criado antes.
              </p>
              <label class="flex cursor-pointer items-start gap-2.5 t-caption text-text-primary select-none">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 shrink-0 accent-action-danger cursor-pointer"
                  [checked]="confirmDowngrade()"
                  (change)="confirmDowngrade.set($any($event.target).checked)"
                />
                <span>Entendo os riscos e confirmo que desejo fazer downgrade da versão.</span>
              </label>
            </div>
          }
        </div>
      </mc-dialog>
    } @else if (step() === 'result') {
      @if (updateResult(); as res) {
        <mc-dialog
          [open]="true"
          [title]="res.rolledBack ? 'Rollback executado' : 'Versão atualizada com sucesso'"
          confirmLabel="Concluir"
          [confirmVariant]="res.rolledBack ? 'danger' : 'info'"
          [hideCancel]="true"
          (confirmed)="close()"
          (cancelled)="close()"
        >
          @if (res.rolledBack) {
            <p class="text-status-danger font-medium mb-3">
              A nova versão não iniciou corretamente. O rollback automático restaurou o mundo para a versão anterior.
            </p>
            <p class="t-body-md">
              Versão ativa: <strong>{{ res.version }}</strong>
            </p>
          } @else {
            <p class="text-status-success font-medium mb-3">
              O servidor foi atualizado com sucesso.
            </p>
            <p class="t-body-md">
              Versão ativa: <strong>{{ res.version }}</strong>
            </p>
          }
        </mc-dialog>
      }
    }
  `,
})
export class McUpdateVersionDialog {
  private readonly api = inject(ServersApi);
  protected readonly store = inject(ServerDetailStore);
  private readonly toast = inject(ToastService);

  protected readonly step = signal<Step>(null);
  protected readonly targetVersion = signal('');
  protected readonly confirmDowngrade = signal(false);
  protected readonly versionsList = signal<MinecraftVersionItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly updateResult = signal<UpdateVersionResponse | null>(null);
  private trigger: HTMLElement | null = null;

  protected readonly currentVersion = computed(() => this.store.server()?.game_version ?? '');
  protected readonly serverType = computed(() => this.store.server()?.server_type ?? 'VANILLA');
  protected readonly serverName = computed(() => this.store.server()?.name ?? '');

  protected readonly isDowngrade = computed<boolean>(() => {
    const from = this.currentVersion();
    const to = this.targetVersion();
    if (!from || !to || from === to) return false;

    const list = this.versionsList();
    const itemFrom = list.find((v) => v.id === from);
    const itemTo = list.find((v) => v.id === to);

    if (itemFrom?.releaseTime && itemTo?.releaseTime) {
      return Date.parse(itemTo.releaseTime) < Date.parse(itemFrom.releaseTime);
    }

    return compareVersions(from, to) > 0;
  });

  open(): void {
    this.trigger = document.activeElement as HTMLElement | null;
    this.targetVersion.set(this.currentVersion());
    this.confirmDowngrade.set(false);
    this.updateResult.set(null);
    this.loadVersions();
    this.step.set('confirm');
  }

  close(): void {
    this.step.set(null);
    setTimeout(() => this.trigger?.focus());
  }

  setVersions(versions: MinecraftVersionItem[]): void {
    this.versionsList.set(versions);
  }

  setTargetVersion(version: string): void {
    this.targetVersion.set(version);
  }

  protected canConfirm(): boolean {
    const to = this.targetVersion();
    if (!to || to === this.currentVersion()) return false;
    if (this.isDowngrade() && !this.confirmDowngrade()) return false;
    return !this.busy();
  }

  protected async submit(): Promise<void> {
    const serverId = this.store.serverId();
    const to = this.targetVersion();
    if (!serverId || !to) return;

    this.busy.set(true);
    try {
      const response = await firstValueFrom(
        this.api.updateVersion(serverId, {
          game_version: to,
          confirm_downgrade: this.confirmDowngrade(),
        }),
      );
      this.updateResult.set(response);
      this.store.refresh();
      this.step.set('result');
      if (response.rolledBack) {
        this.toast.error('Rollback executado: nova versão falhou ao iniciar.');
      } else {
        this.toast.success(`Versão atualizada para ${response.version}.`);
      }
    } catch (error: unknown) {
      this.toast.error(`Falha ao atualizar versão: ${errorReason(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private loadVersions(): void {
    const type = this.serverType();
    if (!type) return;
    this.api
      .listMinecraftVersions(type, true)
      .pipe(catchError(() => of([])))
      .subscribe((versions) => {
        this.versionsList.set(versions);
      });
  }
}
