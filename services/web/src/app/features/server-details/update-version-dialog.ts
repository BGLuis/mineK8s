import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Observable, catchError, firstValueFrom, of } from 'rxjs';

import {
  ContentActionRequest,
  ContentPreviewItem,
  MinecraftVersionItem,
  ModpackVersion,
  UpdateVersionResponse,
} from '../../core/api/models';
import { ModpacksApi } from '../../core/api/modpacks.api';
import { ServersApi } from '../../core/api/servers.api';
import { McDialog, McSelect, McVersionSelector, ToastService } from '../../ui';
import { ServerLifecycle, errorReason } from '../dashboard/server-lifecycle';
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
  imports: [McDialog, McSelect, McVersionSelector],
  template: `
    @if (step() === 'confirm') {
      <mc-dialog
        [open]="true"
        [title]="'Atualizar versão de &quot;' + serverName() + '&quot;'"
        [confirmLabel]="isDowngrade() ? 'Fazer downgrade' : modpackId() ? 'Atualizar modpack' : 'Atualizar versão'"
        [confirmVariant]="isDowngrade() ? 'danger' : 'warning'"
        [confirmDisabled]="!canConfirm()"
        cancelLabel="Cancelar"
        (confirmed)="submit()"
        (cancelled)="close()"
      >
        <div class="space-y-4">
          @if (modpackId()) {
            <p class="t-caption text-text-muted">
              Modpack atual:
              <strong class="text-text-primary">{{ currentPackVersion()?.name ?? currentPackVersionId() ?? 'versão desconhecida' }}</strong>
              (Minecraft {{ currentVersion() }}, {{ serverType() }})
            </p>

            <div>
              <mc-select
                label="Nova versão do modpack"
                [options]="packVersionOptions()"
                [placeholder]="packVersionsLoading() ? 'Carregando versões…' : 'Selecione uma versão'"
                [disabled]="packVersionsLoading() || packVersions().length === 0"
                [value]="targetPackVersionId()"
                (valueChange)="targetPackVersionId.set($event)"
              />
              <p class="t-caption mt-1 text-text-muted">
                A versão do Minecraft e o loader acompanham o pack. Os arquivos da versão anterior do pack são trocados; mods adicionados à mão são mantidos.
              </p>
            </div>
          } @else {
            <p class="t-caption text-text-muted">
              Versão atual: <strong class="text-text-primary">{{ currentVersion() }}</strong> ({{ serverType() }})
            </p>

            <mc-version-selector
              label="Nova versão do Minecraft"
              [serverType]="serverType()"
              [versions]="versionsList().length > 0 ? versionsList() : null"
              [value]="targetVersion()"
              (valueChange)="setTargetVersion($event)"
            />
          }

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

          @if (previewLoading()) {
            <p class="t-caption text-text-muted animate-pulse">
              Verificando compatibilidade de mods e plugins...
            </p>
          } @else if (previewItems().length > 0) {
            <div class="space-y-2 border border-border-subtle p-3 rounded">
              <div class="flex items-center justify-between">
                <h4 class="t-body-sm font-semibold text-text-primary">Compatibilidade de Mods e Plugins</h4>
                <span class="t-caption text-text-muted">{{ previewItems().length }} itens</span>
              </div>
              <p class="t-caption text-text-muted">
                Selecione as ações desejadas antes da troca de versão:
              </p>
              <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                @for (item of previewItems(); track item.path) {
                  <div class="flex items-center justify-between gap-3 p-2 border border-border-subtle/50 rounded bg-bg-surface">
                    <div class="min-w-0 flex-1">
                      <p class="t-body-sm font-medium truncate text-text-primary" [title]="item.name">{{ item.name }}</p>
                      <div class="flex items-center gap-2 mt-0.5">
                        @if (item.status === 'UPDATE_AVAILABLE') {
                          <span class="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-status-success/15 text-status-success">
                            {{ item.statusMessage }}
                          </span>
                        } @else if (item.status === 'COMPATIBLE') {
                          <span class="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-status-success/15 text-status-success">
                            {{ item.statusMessage }}
                          </span>
                        } @else if (item.status === 'INCOMPATIBLE') {
                          <span class="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-status-danger/15 text-status-danger">
                            {{ item.statusMessage }}
                          </span>
                        } @else {
                          <span class="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-text-muted/15 text-text-muted">
                            {{ item.statusMessage }}
                          </span>
                        }
                        <span class="text-xs text-text-muted">{{ item.origin === 'MODPACK' ? 'Modpack' : 'Manual' }}</span>
                      </div>
                    </div>

                    <select
                      class="text-xs bg-bg-panel border border-border-subtle rounded px-2 py-1 text-text-primary cursor-pointer shrink-0"
                      [value]="getItemAction(item.path)"
                      (change)="setItemAction(item.path, $any($event.target).value)"
                    >
                      @if (item.status === 'UPDATE_AVAILABLE') {
                        <option value="UPDATE">Atualizar</option>
                      }
                      <option value="KEEP">Manter</option>
                      <option value="REMOVE">Remover</option>
                    </select>
                  </div>
                }
              </div>
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
  private readonly modpacksApi = inject(ModpacksApi);
  protected readonly store = inject(ServerDetailStore);
  private readonly toast = inject(ToastService);
  private readonly lifecycle = inject(ServerLifecycle);

  protected readonly step = signal<Step>(null);
  protected readonly targetVersion = signal('');
  protected readonly confirmDowngrade = signal(false);
  protected readonly versionsList = signal<MinecraftVersionItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly updateResult = signal<UpdateVersionResponse | null>(null);

  protected readonly previewLoading = signal(false);
  protected readonly previewItems = signal<ContentPreviewItem[]>([]);
  protected readonly selectedActions = signal<Record<string, 'UPDATE' | 'REMOVE' | 'KEEP'>>({});

  private trigger: HTMLElement | null = null;

  protected readonly currentVersion = computed(() => this.store.server()?.game_version ?? '');
  protected readonly serverType = computed(() => this.store.server()?.server_type ?? 'VANILLA');
  protected readonly serverName = computed(() => this.store.server()?.name ?? '');

  protected readonly modpackId = computed(() => this.store.server()?.modpack_id ?? null);
  protected readonly currentPackVersionId = computed(
    () => this.store.server()?.modpack_version_id ?? null,
  );
  protected readonly packVersions = signal<ModpackVersion[]>([]);
  protected readonly packVersionsLoading = signal(false);
  protected readonly targetPackVersionId = signal('');
  protected readonly currentPackVersion = computed(() =>
    this.findPackVersion(this.currentPackVersionId()),
  );
  protected readonly targetPackVersion = computed(() =>
    this.findPackVersion(this.targetPackVersionId()),
  );
  protected readonly packVersionOptions = computed(() =>
    this.packVersions().map((v) => ({
      value: v.id,
      label: `${v.name} · Minecraft ${v.gameVersion} · ${v.loader}`,
    })),
  );

  protected readonly isDowngrade = computed<boolean>(() => {
    if (this.modpackId()) {
      return this.isPackDowngrade();
    }
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
    this.previewItems.set([]);
    this.selectedActions.set({});
    this.targetPackVersionId.set('');
    if (this.modpackId()) {
      this.loadPackVersions();
    } else {
      this.loadVersions();
    }
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
    this.checkCompatibility(version);
  }

  protected getItemAction(path: string): 'UPDATE' | 'REMOVE' | 'KEEP' {
    return this.selectedActions()[path] || 'KEEP';
  }

  protected setItemAction(path: string, action: 'UPDATE' | 'REMOVE' | 'KEEP'): void {
    this.selectedActions.update((prev) => ({ ...prev, [path]: action }));
  }

  protected checkCompatibility(to: string): void {
    const serverId = this.store.serverId();
    if (!serverId || !to || to === this.currentVersion()) {
      this.previewItems.set([]);
      this.selectedActions.set({});
      return;
    }

    this.previewLoading.set(true);
    this.api
      .previewUpdateVersion(serverId, {
        game_version: to,
        server_type: this.serverType(),
      })
      .pipe(
        catchError(() =>
          of({
            canUpdate: true,
            targetGameVersion: to,
            targetServerType: this.serverType(),
            items: [],
          }),
        ),
      )
      .subscribe((res) => {
        if (to !== this.targetVersion()) {
          return;
        }
        this.previewLoading.set(false);
        const items = res.items || [];
        this.previewItems.set(items);
        const actions: Record<string, 'UPDATE' | 'REMOVE' | 'KEEP'> = {};
        for (const item of items) {
          if (item.status === 'UPDATE_AVAILABLE') {
            actions[item.path] = 'UPDATE';
          } else if (item.status === 'INCOMPATIBLE') {
            actions[item.path] = 'REMOVE';
          } else {
            actions[item.path] = 'KEEP';
          }
        }
        this.selectedActions.set(actions);
      });
  }

  protected canConfirm(): boolean {
    if (this.modpackId()) {
      const target = this.targetPackVersionId();
      if (!target || target === this.currentPackVersionId()) return false;
      if (this.isDowngrade() && !this.confirmDowngrade()) return false;
      return !this.busy() && !this.packVersionsLoading();
    }
    const to = this.targetVersion();
    if (!to || to === this.currentVersion()) return false;
    if (this.isDowngrade() && !this.confirmDowngrade()) return false;
    return !this.busy() && !this.previewLoading();
  }

  protected async submit(): Promise<void> {
    const serverId = this.store.serverId();
    const request = serverId ? this.updateRequest(serverId) : null;
    if (!serverId || !request) return;

    this.busy.set(true);
    try {
      const response = await firstValueFrom(request);
      this.updateResult.set(response);
      this.store.refresh();
      if (response.taskId) {
        this.lifecycle.trackTask(serverId, response.taskId, 'update-version');
        this.toast.success(
          `Atualização agendada com aviso aos jogadores (versão ${response.version}).`,
        );
        this.close();
      } else {
        this.step.set('result');
        if (response.rolledBack) {
          this.toast.error('Rollback executado: nova versão falhou ao iniciar.');
        } else {
          this.toast.success(`Versão atualizada para ${response.version}.`);
        }
      }
    } catch (error: unknown) {
      this.toast.error(`Falha ao atualizar versão: ${errorReason(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private updateRequest(serverId: string): Observable<UpdateVersionResponse> | null {
    if (this.modpackId()) {
      const versionId = this.targetPackVersionId();
      return versionId
        ? this.modpacksApi.update(serverId, {
            versionId,
            confirm_downgrade: this.confirmDowngrade(),
          })
        : null;
    }

    const to = this.targetVersion();
    if (!to) return null;
    const content_actions: ContentActionRequest[] = this.previewItems().map((item) => ({
      path: item.path,
      action: this.getItemAction(item.path),
      projectId: item.projectId ?? undefined,
      targetVersionId: item.targetVersionId,
      targetDownloadUrl: item.targetDownloadUrl,
      targetFileName: item.targetFileName,
      targetHashes: item.targetHashes,
    }));
    return this.api.updateVersion(serverId, {
      game_version: to,
      confirm_downgrade: this.confirmDowngrade(),
      ...(content_actions.length > 0 ? { content_actions } : {}),
    });
  }

  private findPackVersion(id: string | null): ModpackVersion | null {
    return id ? (this.packVersions().find((v) => v.id === id) ?? null) : null;
  }

  /** Older pack release, or one that moves Minecraft back: both can leave the world unreadable. */
  private isPackDowngrade(): boolean {
    const target = this.targetPackVersion();
    if (!target) return false;
    if (compareVersions(this.currentVersion(), target.gameVersion) > 0) return true;
    const current = this.currentPackVersion();
    return !!current && Date.parse(target.datePublished) < Date.parse(current.datePublished);
  }

  private loadPackVersions(): void {
    const modpackId = this.modpackId();
    if (!modpackId) return;
    this.packVersions.set([]);
    this.packVersionsLoading.set(true);
    this.modpacksApi
      .versions(modpackId)
      .pipe(catchError(() => of<ModpackVersion[]>([])))
      .subscribe((versions) => {
        const sorted = [...versions].sort(
          (a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished),
        );
        this.packVersions.set(sorted);
        this.packVersionsLoading.set(false);
        this.targetPackVersionId.set(sorted[0]?.id ?? '');
      });
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
