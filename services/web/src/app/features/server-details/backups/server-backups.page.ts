import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { BackupsApi } from '../../../core/api/backups.api';
import { BackupMode, ServerBackup, ServerState, TaskProgress } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import { TasksSocket } from '../../../core/realtime/tasks-socket';
import { AuthSession } from '../../../core/auth/auth-session';
import {
  McBanner,
  McButton,
  McDialog,
  McIcon,
  McProgress,
  McTable,
  ToastService,
} from '../../../ui';
import {
  BACKUP_STATUS,
  BackupTone,
  RETENTION_SUMMARY,
  backupDisplayPercent,
  backupDownloadName,
  backupErrorMessage,
  backupTypeLabel,
  canRestore,
  formatBackupDate,
  formatBackupSize,
  formatFreeze,
  isForceableDeleteError,
  shortHash,
  storageSummary,
} from './backups.model';

type DialogKind = 'restore' | 'delete' | 'force';

interface DialogState {
  kind: DialogKind;
  backup: ServerBackup;
  reason?: string;
}

interface Operation {
  mode: BackupMode;
  phase: 'running' | 'done' | 'failed';
  filename?: string;
  freezeMs?: number;
}

const TONE_CLASSES: Record<BackupTone, string> = {
  success: 'text-status-success',
  danger: 'text-status-danger',
  warning: 'text-status-warning',
  info: 'text-status-info',
};

const STATE_LABELS: Partial<Record<ServerState, string>> = {
  READY: 'ONLINE',
  STARTING: 'INICIANDO',
  STOPPING: 'PARANDO',
  UPDATING: 'ATUALIZANDO',
  CRASHED: 'TRAVADO',
  PROVISIONING: 'PROVISIONANDO',
  FAILED: 'COM FALHA',
};

@Component({
  selector: 'mc-server-backups-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McBanner, McButton, McDialog, McIcon, McProgress, McTable],
  template: `
    <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-72 flex-1">
        <h2 class="t-title-md">Cópias de segurança</h2>
        <p class="t-body-md mt-1 text-text-muted">
          {{ retention }}
          @if (!loading() && !loadError()) {
            · {{ storage() }}
          }
        </p>
      </div>
      <div class="flex flex-wrap gap-4">
        <mc-button variant="neutral" [disabled]="running()" (click)="createBackup('COLD')">
          Backup a frio
        </mc-button>
        <mc-button variant="primary" [disabled]="running()" (click)="createBackup('HOT')">
          Backup a quente agora
        </mc-button>
      </div>
    </div>
    <p class="t-caption mb-4 text-text-muted">
      O backup a quente exige o servidor ONLINE; o a frio, o servidor parado.
    </p>

    @if (operation(); as op) {
      <section
        class="bevel-sunken mb-6 bg-surface-default p-4"
        aria-label="Andamento do backup"
        aria-live="polite"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p class="t-label-md">{{ op.mode === 'HOT' ? 'Backup a quente' : 'Backup a frio' }}</p>
          <div class="flex flex-wrap items-center gap-4">
            @if (op.mode === 'HOT') {
              <p class="t-body-md">
                <span class="t-caption text-text-muted uppercase">Freeze do mundo</span>
                <span class="t-title-sm ml-2 text-status-success">{{ freeze() }}</span>
              </p>
            }
            @if (op.phase !== 'running') {
              <mc-button size="sm" variant="neutral" (click)="operation.set(null)">
                Ocultar
              </mc-button>
            }
          </div>
        </div>
        <mc-progress
          class="mt-3"
          [percent]="percent()"
          [tone]="op.phase === 'failed' ? 'danger' : 'info'"
          [step]="stepText()"
        />
      </section>
    }
    @if (operationError()) {
      <mc-banner class="mb-6" tone="danger" title="Backup não realizado" [dismissible]="true" (dismissed)="operationError.set('')">
        {{ operationError() }}
      </mc-banner>
    }

    @if (loading()) {
      <p class="t-body-lg text-text-muted" role="status">Carregando backups…</p>
    } @else if (loadError()) {
      <mc-banner tone="danger" title="Não foi possível carregar os backups">
        {{ loadError() }}
      </mc-banner>
      <div class="mt-3">
        <mc-button size="sm" variant="neutral" (click)="reload()">Tentar de novo</mc-button>
      </div>
    } @else if (backups().length === 0) {
      <div class="bevel-panel has-drop box-border bg-surface-default p-6 text-center">
        <p class="t-title-sm">Nenhum backup ainda</p>
        <p class="t-body-md mt-2 text-text-muted">
          Crie o primeiro com "Backup a quente agora" ou "Backup a frio".
        </p>
      </div>
    } @else {
      <div class="bevel-panel has-drop box-border overflow-x-auto bg-surface-default">
        <table mc-table class="min-w-208">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Tipo</th>
              <th scope="col" class="mc-cell-num">Tamanho</th>
              <th scope="col">SHA-256</th>
              <th scope="col">Versão</th>
              <th scope="col">Status</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            @for (backup of backups(); track backup.id) {
              <tr>
                <td class="whitespace-nowrap">{{ date(backup) }}</td>
                <td>
                  {{ typeLabel(backup) }}
                  @if (backup.isProtected) {
                    <span
                      class="t-caption ml-1 border-2 border-status-warning px-1 text-status-warning"
                      title="Protegido: não pode ser excluído (403)"
                    >
                      protegido
                    </span>
                  }
                </td>
                <td class="mc-cell-num whitespace-nowrap">{{ size(backup) }}</td>
                <td>
                  @if (backup.sha256Checksum) {
                    <span class="inline-flex items-center gap-1">
                      <span [title]="backup.sha256Checksum">{{ hash(backup) }}</span>
                      <button
                        type="button"
                        class="inline-flex size-10 items-center justify-center text-text-muted hover:text-text-primary"
                        aria-label="Copiar SHA-256 completo"
                        (click)="copyHash(backup)"
                      >
                        <mc-icon name="copy" [size]="16" />
                      </button>
                    </span>
                  } @else {
                    —
                  }
                </td>
                <td>{{ version(backup) }}</td>
                <td [class]="statusClass(backup)">{{ statusLabel(backup) }}</td>
                <td>
                  <div class="flex flex-wrap gap-2">
                    @if (restorable(backup)) {
                      <mc-button
                        size="sm"
                        variant="neutral"
                        [disabled]="downloadingId() === backup.id"
                        (click)="download(backup)"
                      >
                        {{ downloadingId() === backup.id ? 'Baixando…' : 'Baixar' }}
                      </mc-button>
                      <mc-button
                        size="sm"
                        variant="warning"
                        [disabled]="restoringId() !== null"
                        (click)="openDialog('restore', backup)"
                      >
                        {{ restoringId() === backup.id ? 'Restaurando…' : 'Restaurar' }}
                      </mc-button>
                    }
                    <mc-button size="sm" variant="danger" (click)="openDialog('delete', backup)">
                      Excluir
                    </mc-button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <p class="t-caption mt-6 text-text-muted">
      Protegido não pode ser excluído (403). Pré-restauração com menos de 48 h não pode ser excluída
      (400). Restaurar exige servidor parado (409).
    </p>

    <mc-dialog
      [(open)]="dialogOpen"
      [title]="dialogTitle()"
      [confirmLabel]="dialogConfirmLabel()"
      [confirmDisabled]="dialog()?.kind === 'force' && !forceAcknowledged()"
      (confirmed)="onDialogConfirmed()"
    >
      @switch (dialog()?.kind) {
        @case ('restore') {
          <p>
            Pare o servidor antes. Um backup de segurança (Pré-restauração) é criado
            automaticamente; se algo falhar, o mundo volta ao estado atual. Os jogadores perdem o
            progresso feito depois deste backup.
          </p>
          @if (notStoppedLabel(); as label) {
            <p class="mt-3 text-status-warning">
              O servidor está {{ label }} agora. Pare-o primeiro, ou a restauração será recusada.
            </p>
          }
        }
        @case ('delete') {
          <p>O arquivo é removido do armazenamento e não dá para desfazer.</p>
        }
        @case ('force') {
          <p>{{ dialog()?.reason }}</p>
          <p class="mt-3">
            Como administrador, você pode forçar a exclusão. A retenção de segurança será ignorada.
          </p>
          <label class="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              class="mt-1 size-5 shrink-0 accent-action-danger"
              [checked]="forceAcknowledged()"
              (change)="forceAcknowledged.set($any($event.target).checked)"
            />
            <span>Entendo que este backup será apagado definitivamente.</span>
          </label>
        }
      }
    </mc-dialog>
  `,
})
export class ServerBackupsPage {
  private readonly backupsApi = inject(BackupsApi);
  private readonly servers = inject(ServersApi);
  private readonly tasksSocket = inject(TasksSocket);
  private readonly session = inject(AuthSession);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();

  protected readonly retention = RETENTION_SUMMARY;
  protected readonly backups = signal<ServerBackup[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  private readonly serverState = signal<ServerState | null>(null);
  private readonly serverName = signal('');

  protected readonly operation = signal<Operation | null>(null);
  protected readonly operationError = signal('');
  protected readonly taskProgress = signal<TaskProgress | null>(null);
  private taskSub: Subscription | null = null;

  protected readonly restoringId = signal<string | null>(null);
  protected readonly downloadingId = signal<string | null>(null);

  protected readonly dialogOpen = signal(false);
  protected readonly dialog = signal<DialogState | null>(null);
  protected readonly forceAcknowledged = signal(false);

  protected readonly storage = computed(() => storageSummary(this.backups()));
  protected readonly running = computed(() => this.operation()?.phase === 'running');
  protected readonly percent = computed(() =>
    backupDisplayPercent(
      this.taskProgress()?.progressPercent ?? 0,
      this.operation()?.phase === 'done',
    ),
  );
  protected readonly stepText = computed(() => {
    const op = this.operation();
    if (op?.phase === 'done') {
      return `Concluído · ${op.filename ?? ''}`;
    }
    if (op?.phase === 'failed') {
      return 'Falhou';
    }
    const step = this.taskProgress()?.currentStep ?? 'Iniciando…';
    return this.percent() >= 90 && !step.includes('sucesso') ? 'Finalizando…' : step;
  });
  protected readonly freeze = computed(() =>
    formatFreeze(this.operation()?.freezeMs ?? this.taskProgress()?.freezeDurationMs),
  );
  protected readonly notStoppedLabel = computed(() => {
    const state = this.serverState();
    return state && state !== 'STOPPED' ? (STATE_LABELS[state] ?? state) : '';
  });
  protected readonly dialogTitle = computed(() => {
    const dialog = this.dialog();
    if (!dialog) {
      return '';
    }
    const date = formatBackupDate(dialog.backup.createdAt);
    switch (dialog.kind) {
      case 'restore':
        return `Restaurar backup de ${date}?`;
      case 'delete':
        return `Excluir backup de ${date}?`;
      default:
        return 'Forçar a exclusão?';
    }
  });
  protected readonly dialogConfirmLabel = computed(() => {
    switch (this.dialog()?.kind) {
      case 'restore':
        return 'Restaurar';
      case 'force':
        return 'Forçar exclusão';
      default:
        return 'Excluir';
    }
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.servers.get(id).subscribe({
          next: (server) => {
            this.serverState.set(server.state);
            this.serverName.set(server.name);
          },
          error: () => this.serverState.set(null),
        });
        this.reload();
      });
    });
    this.destroyRef.onDestroy(() => this.taskSub?.unsubscribe());
  }

  protected reload(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.backupsApi.list(this.id()).subscribe({
      next: (backups) => {
        this.backups.set(backups);
        this.loading.set(false);
      },
      error: (error) => {
        this.loadError.set(backupErrorMessage('list', error));
        this.loading.set(false);
      },
    });
  }

  protected createBackup(mode: BackupMode): void {
    if (this.running()) {
      return;
    }
    const taskId = `backup-task-${Date.now()}`;
    this.operationError.set('');
    this.operation.set({ mode, phase: 'running' });
    this.taskProgress.set({
      taskId,
      serverId: this.id(),
      status: 'IN_PROGRESS',
      progressPercent: 10,
      downloadedFiles: 0,
      totalFiles: 0,
      currentStep: 'Iniciando criação de backup...',
    });
    this.taskSub?.unsubscribe();
    this.taskSub = this.tasksSocket.progress(taskId).subscribe({
      next: (progress) => {
        this.taskProgress.set(progress);
        if (progress.freezeDurationMs && !this.operation()?.freezeMs) {
          const current = this.operation();
          if (current) {
            this.operation.set({ ...current, freezeMs: progress.freezeDurationMs });
          }
        }
      },
      error: () => {},
    });

    this.backupsApi.create(this.id(), mode, taskId).subscribe({
      next: ({ result }) => {
        this.taskSub?.unsubscribe();
        this.operation.set({
          mode,
          phase: 'done',
          filename: result.filename,
          freezeMs: result.freezeDurationMs,
        });
        this.toast.success(
          mode === 'HOT' ? 'Backup a quente concluído.' : 'Backup a frio concluído.',
        );
        this.reload();
      },
      error: (error) => {
        this.taskSub?.unsubscribe();
        this.operation.set({ mode, phase: 'failed' });
        this.operationError.set(backupErrorMessage('create', error, mode));
      },
    });
  }

  protected openDialog(kind: DialogKind, backup: ServerBackup, reason?: string): void {
    this.forceAcknowledged.set(false);
    this.dialog.set({ kind, backup, reason });
    this.dialogOpen.set(true);
  }

  protected onDialogConfirmed(): void {
    const dialog = this.dialog();
    if (!dialog) {
      return;
    }
    switch (dialog.kind) {
      case 'restore':
        this.restore(dialog.backup);
        break;
      case 'delete':
        this.remove(dialog.backup, false);
        break;
      default:
        this.remove(dialog.backup, true);
    }
  }

  protected download(backup: ServerBackup): void {
    this.downloadingId.set(backup.id);
    this.backupsApi.download(this.id(), backup.id).subscribe({
      next: (blob) => {
        this.downloadingId.set(null);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = backupDownloadName(this.serverName(), backup.createdAt);
        // Attached and revoked later: some browsers ignore `download` on a detached link or a URL
        // revoked right away, and save the file under the blob's UUID.
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: (error) => {
        this.downloadingId.set(null);
        this.toast.error(backupErrorMessage('download', error));
      },
    });
  }

  protected async copyHash(backup: ServerBackup): Promise<void> {
    try {
      await navigator.clipboard.writeText(backup.sha256Checksum);
      this.toast.success('SHA-256 copiado.');
    } catch {
      this.toast.error('Não foi possível copiar. Selecione o hash e copie manualmente.');
    }
  }

  protected date(backup: ServerBackup): string {
    return formatBackupDate(backup.createdAt);
  }

  protected typeLabel(backup: ServerBackup): string {
    return backupTypeLabel(backup.backupType);
  }

  protected size(backup: ServerBackup): string {
    return formatBackupSize(backup.sizeBytes);
  }

  protected hash(backup: ServerBackup): string {
    return shortHash(backup.sha256Checksum);
  }

  protected version(backup: ServerBackup): string {
    return backup.modpackVersion
      ? `${backup.minecraftVersion} · ${backup.modpackVersion}`
      : backup.minecraftVersion;
  }

  protected statusLabel(backup: ServerBackup): string {
    return BACKUP_STATUS[backup.status]?.label ?? backup.status;
  }

  protected statusClass(backup: ServerBackup): string {
    return TONE_CLASSES[BACKUP_STATUS[backup.status]?.tone ?? 'info'];
  }

  protected restorable(backup: ServerBackup): boolean {
    return canRestore(backup);
  }

  private restore(backup: ServerBackup): void {
    this.restoringId.set(backup.id);
    const taskId = `restore-task-${Date.now()}`;
    this.taskSub?.unsubscribe();
    this.taskSub = this.tasksSocket.progress(taskId).subscribe({
      next: (progress) => {
        if (progress.status === 'COMPLETED') {
          this.toast.success('Restauração concluída com sucesso!');
        }
      },
      error: () => {},
    });

    this.backupsApi.restore(this.id(), backup.id, taskId).subscribe({
      next: () => {
        this.restoringId.set(null);
        this.taskSub?.unsubscribe();
        this.toast.success('Restauração concluída. O backup Pré-restauração aparece no histórico.');
        this.reload();
      },
      error: (error) => {
        this.restoringId.set(null);
        this.taskSub?.unsubscribe();
        this.toast.error(backupErrorMessage('restore', error));
      },
    });
  }

  private remove(backup: ServerBackup, force: boolean): void {
    this.backupsApi.delete(this.id(), backup.id, force).subscribe({
      next: () => {
        this.toast.success('Backup excluído.');
        this.reload();
      },
      error: (error) => {
        const message = backupErrorMessage('delete', error);
        if (!force && this.session.isAdmin() && isForceableDeleteError(error)) {
          this.openDialog('force', backup, message);
        } else {
          this.toast.error(message);
        }
      },
    });
  }
}
