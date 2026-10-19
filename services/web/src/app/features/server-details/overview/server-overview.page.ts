import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, map, of, switchMap } from 'rxjs';

import { AdminApi } from '../../../core/api/admin.api';
import { OnlinePlayer, ServerState, UpdateServerRequest } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import {
  DialogService,
  McButton,
  McPanel,
  McPlayerHead,
  McRamSlider,
  McSwitch,
  McTextField,
  ToastService,
} from '../../../ui';
import { errorReason } from '../../dashboard/server-lifecycle';
import { formatDuration } from '../format';
import { ServerDetailStore } from '../server-detail.store';
import { McUpdateVersionDialog } from '../update-version-dialog';
import { formatMemory, TPS_TARGET, tpsLevel, tpsSeries } from './performance';
import {
  QuickSettings,
  diffSettings,
  hasChanges,
  policyLabel,
  validateSleepMinutes,
  validateStopWarningMinutes,
  validateSubdomain,
} from './quick-settings';

const AVATAR_COLORS = [
  'bg-scene-sky',
  'bg-scene-grass',
  'bg-scene-dirt',
  'bg-action-accent',
  'bg-action-info',
  'bg-action-primary',
] as const;

const BAR_CLASSES = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
} as const;

const TEXT_CLASSES = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
} as const;

/** States in which the control plane restarts the server to apply a new memory size. */
const RUNNING_STATES: ReadonlySet<ServerState> = new Set(['READY', 'CRASHED']);

function avatarColor(nick: string): string {
  let hash = 0;
  for (const char of nick) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

@Component({
  selector: 'mc-server-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    McButton,
    McPanel,
    McPlayerHead,
    McRamSlider,
    McSwitch,
    McTextField,
    McUpdateVersionDialog,
  ],
  template: `
    @if (store.server(); as server) {
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="flex min-w-0 flex-col gap-6">
          <mc-panel title="Desempenho">
            @if (store.stats(); as stats) {
              @if (stats.history.length > 0) {
                <dl class="mb-4 flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <dt class="t-caption text-text-muted">TPS</dt>
                    <dd class="t-title-sm" [class]="tpsTextClass()">{{ tpsText() }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">MSPT</dt>
                    <dd class="t-title-sm">{{ msptText() }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Memória do container</dt>
                    <dd class="t-title-sm">{{ formatMemory(stats.memoryUsedMb, stats.memoryLimitMb) }}</dd>
                  </div>
                </dl>
                @if (tpsBars().length > 0) {
                  <div
                    class="bevel-sunken flex h-28 items-end gap-0.5 bg-bg-sunken p-2"
                    role="img"
                    [attr.aria-label]="chartLabel()"
                  >
                    @for (value of tpsBars(); track $index) {
                      <span
                        class="min-h-1 flex-1"
                        [class]="barClass(value)"
                        [style.height.%]="(value / tpsTarget) * 100"
                      ></span>
                    }
                  </div>
                  <p class="t-caption mt-2 text-text-muted">
                    TPS nos últimos {{ tpsBars().length }} min (uma amostra por minuto)
                  </p>
                } @else {
                  <p class="t-body-md text-text-muted">
                    Este servidor não informa TPS; só a memória está disponível.
                  </p>
                }
              } @else {
                <p class="t-body-md text-text-muted" role="status">
                  Coletando as primeiras amostras; elas chegam a cada minuto.
                </p>
              }
            } @else if (server.state === 'READY') {
              <p class="t-body-md text-text-muted" role="status">Carregando métricas…</p>
            } @else {
              <p class="t-body-md text-text-muted">
                O servidor não está online, então não há métricas para exibir.
              </p>
            }
          </mc-panel>

          <mc-panel [title]="'Jogadores online · ' + onlinePlayers().length">
            @if (onlinePlayers().length === 0) {
              <p class="t-body-md text-text-muted">Nenhum jogador conectado no momento.</p>
            } @else {
              <ul class="flex flex-col gap-3">
                @for (player of onlinePlayers(); track player.nick) {
                  <li class="flex items-center gap-3 border-b-2 border-border-strong pb-3">
                    <mc-player-head
                      class="border-2 border-border-strong"
                      [class]="avatarClass(player.nick)"
                      [nick]="player.nick"
                    />
                    <span class="t-body-strong min-w-0 flex-1 truncate">{{ player.nick }}</span>
                    <span class="t-body-md text-text-muted">{{ session(player) }}</span>
                    <mc-button
                      size="sm"
                      [ariaLabel]="'Expulsar ' + player.nick"
                      [disabled]="kicking() === player.nick"
                      (click)="kick(player.nick)"
                    >
                      Expulsar
                    </mc-button>
                  </li>
                }
              </ul>
            }
          </mc-panel>
        </div>

        <div class="flex min-w-0 flex-col gap-6">
          <mc-panel title="Versão do jogo">
            <div class="flex items-center justify-between">
              <div>
                <p class="t-caption text-text-muted">Versão instalada</p>
                <p class="t-title-sm">{{ server.server_type }} {{ server.game_version }}</p>
              </div>
              <mc-button size="sm" variant="neutral" (click)="updateDialog.open()">
                Atualizar versão
              </mc-button>
            </div>
          </mc-panel>

          <mc-panel title="Configurações rápidas">
            <div class="flex flex-col gap-5">
              <div>
                <mc-ram-slider [ngModel]="memory()" (ngModelChange)="memory.set($event)" />
              </div>

              <div>
                <mc-text-field
                  label="Hibernar após (minutos)"
                  inputmode="numeric"
                  helpText="Minutos sem jogadores até o mundo desligar sozinho. Com 0, ele nunca desliga (máx. 1440)."
                  [errorText]="sleepError() ?? ''"
                  [ngModel]="sleep()"
                  (ngModelChange)="sleep.set($event)"
                />
              </div>

              <div>
                <mc-text-field
                  label="Aviso antes de parar (minutos)"
                  inputmode="numeric"
                  helpText="Tempo em minutos para avisar jogadores antes de desligar ou reiniciar (0 desliga o aviso)."
                  [errorText]="stopWarningError() ?? ''"
                  [ngModel]="stopWarning()"
                  (ngModelChange)="stopWarning.set($event)"
                />
              </div>

              <mc-text-field
                label="Subdomínio"
                autocomplete="off"
                helpText="Letras minúsculas, números e hífen (2 a 63 caracteres)."
                [errorText]="subdomainError() ?? ''"
                [ngModel]="subdomain()"
                (ngModelChange)="onSubdomain($event)"
              />

              <div class="flex flex-col gap-4">
                <mc-switch label="Modo manutenção" [(checked)]="maintenance">
                  Só admins entram; jogadores recebem aviso.
                </mc-switch>
                <mc-switch label="Acordar ao conectar (auto-wake)" [(checked)]="autoWake">
                  O gateway segura a conexão enquanto o mundo liga.
                </mc-switch>
              </div>

              <mc-button variant="primary" [block]="true" [disabled]="!canSave()" (click)="save()">
                {{ saving() ? 'Salvando…' : 'Salvar alterações' }}
              </mc-button>
            </div>
          </mc-panel>

          <mc-panel title="Quem pode entrar">
            <p class="t-body-md mb-4 flex flex-wrap items-center gap-2 text-text-muted">
              <span
                >Política: <strong class="text-text-primary">{{ policy() }}</strong></span
              >
            </p>
            <mc-button variant="light" size="sm" (click)="manageAccess()"
              >Gerenciar grupos</mc-button
            >
          </mc-panel>
        </div>
      </div>
      <mc-update-version-dialog #updateDialog />
    } @else if (store.loadState() === 'loading') {
      <div
        class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        role="status"
        aria-label="Carregando visão geral"
      >
        <div class="has-drop"><div class="bevel-panel h-80 bg-surface-default"></div></div>
        <div class="has-drop"><div class="bevel-panel h-80 bg-surface-default"></div></div>
      </div>
    }
  `,
})
export class ServerOverviewPage {
  protected readonly store = inject(ServerDetailStore);
  private readonly serversApi = inject(ServersApi);
  private readonly admin = inject(AdminApi);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly tpsTarget = TPS_TARGET;
  protected readonly formatMemory = formatMemory;

  protected readonly tpsText = computed(() => {
    const tps = this.store.stats()?.tps;
    return tps == null
      ? '—'
      : tps.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });
  protected readonly tpsTextClass = computed(() => {
    const tps = this.store.stats()?.tps;
    return tps == null ? 'text-text-muted' : TEXT_CLASSES[tpsLevel(tps)];
  });
  protected readonly msptText = computed(() => {
    const mspt = this.store.stats()?.mspt;
    return mspt == null ? '—' : `${mspt.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ms`;
  });
  protected readonly tpsBars = computed(() => tpsSeries(this.store.stats()?.history ?? []));
  protected readonly chartLabel = computed(() => {
    const series = this.tpsBars();
    const average = series.reduce((sum, value) => sum + value, 0) / series.length;
    const minimum = Math.min(...series);
    const format = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return `Gráfico de TPS dos últimos ${series.length} minutos: média ${format(average)}, mínimo ${format(minimum)}.`;
  });

  private readonly fetchedPlayers = toSignal(
    toObservable(
      // The store replaces `server` on every refresh, so the list is reloaded as players come and go.
      computed(() => {
        const server = this.store.server();
        return server?.state === 'READY' ? server : null;
      }),
    ).pipe(
      switchMap((server) =>
        server
          ? this.serversApi.players(server.id).pipe(
              map((result) => result.players),
              catchError(() => of([] as OnlinePlayer[])),
            )
          : of([] as OnlinePlayer[]),
      ),
    ),
    { initialValue: [] as OnlinePlayer[] },
  );
  private readonly kicked = signal<ReadonlySet<string>>(new Set());
  protected readonly kicking = signal<string | null>(null);
  protected readonly onlinePlayers = computed(() =>
    this.fetchedPlayers().filter((player) => !this.kicked().has(player.nick)),
  );

  protected readonly memory = signal(4096);
  protected readonly sleep = signal('');
  protected readonly stopWarning = signal('10');
  protected readonly subdomain = signal('');
  protected readonly maintenance = signal(false);
  protected readonly autoWake = signal(true);
  protected readonly saving = signal(false);
  private readonly domainConflict = signal<string | null>(null);
  private readonly initial = signal<QuickSettings | null>(null);
  private initialFor: string | null = null;

  private readonly current = computed<QuickSettings>(() => ({
    memoryMb: this.memory(),
    sleepMinutes: this.sleep(),
    stopWarningMinutes: this.stopWarning(),
    subdomain: this.subdomain(),
    maintenance: this.maintenance(),
    autoWake: this.autoWake(),
  }));
  protected readonly sleepError = computed(() => validateSleepMinutes(this.sleep()));
  protected readonly stopWarningError = computed(() =>
    validateStopWarningMinutes(this.stopWarning()),
  );
  protected readonly subdomainError = computed(
    () => this.domainConflict() ?? validateSubdomain(this.subdomain()),
  );
  private readonly changes = computed(() => {
    const initial = this.initial();
    return initial ? diffSettings(initial, this.current()) : null;
  });
  protected readonly canSave = computed(() => {
    const changes = this.changes();
    return (
      changes !== null &&
      hasChanges(changes) &&
      !this.saving() &&
      this.sleepError() === null &&
      this.stopWarningError() === null &&
      this.subdomainError() === null
    );
  });

  protected readonly policy = computed(() => policyLabel(this.store.accessPolicy() ?? 'GROUP'));

  constructor() {
    effect(() => {
      const server = this.store.server();
      if (server && server.id !== this.initialFor) {
        untracked(() => this.resetForm(server));
      }
    });
  }

  protected barClass(tps: number): string {
    return BAR_CLASSES[tpsLevel(tps)];
  }

  protected avatarClass(nick: string): string {
    return avatarColor(nick);
  }

  protected session(player: OnlinePlayer): string {
    return formatDuration(Math.max(0, (Date.now() - Date.parse(player.connectedAt)) / 1000));
  }

  protected onSubdomain(value: string): void {
    this.domainConflict.set(null);
    this.subdomain.set(value);
  }

  protected manageAccess(): void {
    void this.router.navigate(['/access']);
  }

  protected async kick(nick: string): Promise<void> {
    const server = this.store.server();
    if (!server) {
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: `Expulsar ${nick}?`,
      message: `${nick} será desconectado de "${server.name}". Ele poderá entrar de novo se ainda tiver acesso.`,
      confirmLabel: 'Expulsar',
    });
    if (!confirmed) {
      return;
    }
    this.kicking.set(nick);
    try {
      await firstValueFrom(this.admin.smartKick({ serverId: server.id, minecraftNick: nick }));
      this.kicked.update((set) => new Set(set).add(nick));
      this.toast.success(`${nick} foi expulso de "${server.name}".`);
    } catch (error) {
      this.toast.error(`Não foi possível expulsar ${nick}. ${errorReason(error)}`);
    } finally {
      this.kicking.set(null);
    }
  }

  protected async save(): Promise<void> {
    const server = this.store.server();
    const changes = this.changes();
    if (!server || !changes || !this.canSave()) {
      return;
    }
    this.saving.set(true);
    try {
      if (changes.domain !== null && !(await this.saveDomain(server.id, changes.domain))) {
        return;
      }
      if (
        changes.patch.allocated_memory_mb !== undefined &&
        RUNNING_STATES.has(server.state) &&
        !(await this.confirmMemoryRestart(server.name))
      ) {
        return;
      }
      if (
        Object.keys(changes.patch).length > 0 &&
        !(await this.saveSettings(server.id, changes.patch))
      ) {
        return;
      }
      this.initial.update((initial) => initial && { ...initial, ...this.patchedFields() });
    } finally {
      this.saving.set(false);
    }
  }

  private async saveSettings(id: string, patch: UpdateServerRequest): Promise<boolean> {
    try {
      await firstValueFrom(this.serversApi.update(id, patch));
    } catch (error) {
      this.toast.error(`Não foi possível salvar as configurações. ${errorReason(error)}`);
      return false;
    }
    this.toast.success('Configurações salvas.');
    this.store.refresh();
    return true;
  }

  private confirmMemoryRestart(name: string): Promise<boolean> {
    return this.dialog.confirm({
      title: 'Reiniciar para trocar a memória?',
      message: `A JVM só lê a memória ao ligar: "${name}" será salvo, desligado e ligado de novo. Quem estiver jogando cai.`,
      confirmLabel: 'Salvar e reiniciar',
      confirmVariant: 'warning',
    });
  }

  /** Returns false when the user cancelled or the control plane rejected the change. */
  private async saveDomain(id: string, domain: string): Promise<boolean> {
    const confirmed = await this.dialog.confirm({
      title: 'Alterar o subdomínio?',
      message: `O endereço do mundo passa a ser "${domain}". Quem usa o endereço antigo precisa trocá-lo.`,
      confirmLabel: 'Alterar',
      confirmVariant: 'warning',
    });
    if (!confirmed) {
      return false;
    }
    try {
      await firstValueFrom(this.serversApi.updateDomain(id, domain));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.domainConflict.set('Este subdomínio já está em uso.');
      } else {
        this.toast.error(`Não foi possível alterar o subdomínio. ${errorReason(error)}`);
      }
      return false;
    }
    this.initial.update((initial) => initial && { ...initial, subdomain: domain });
    this.toast.success('Subdomínio atualizado.');
    this.store.refresh();
    return true;
  }

  private patchedFields(): Partial<QuickSettings> {
    const { memoryMb, sleepMinutes, stopWarningMinutes, maintenance, autoWake } = this.current();
    return { memoryMb, sleepMinutes, stopWarningMinutes, maintenance, autoWake };
  }

  private resetForm(server: NonNullable<ReturnType<typeof this.store.server>>): void {
    this.initialFor = server.id;
    const settings: QuickSettings = {
      memoryMb: server.allocated_memory_mb,
      sleepMinutes: String(server.sleep_timeout_minutes),
      stopWarningMinutes: String(server.stop_warning_minutes ?? 10),
      subdomain: server.subdomain,
      maintenance: server.is_maintenance,
      autoWake: server.auto_wake,
    };
    this.initial.set(settings);
    this.memory.set(settings.memoryMb);
    this.sleep.set(settings.sleepMinutes);
    this.stopWarning.set(settings.stopWarningMinutes);
    this.subdomain.set(settings.subdomain);
    this.maintenance.set(settings.maintenance);
    this.autoWake.set(settings.autoWake);
  }
}
