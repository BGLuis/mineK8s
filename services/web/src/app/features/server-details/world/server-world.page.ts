import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ServerState } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import {
  McBanner,
  McButton,
  McPanel,
  McSelect,
  McSwitch,
  McTextField,
  SelectOption,
  ToastService,
} from '../../../ui';
import { errorReason } from '../../dashboard/server-lifecycle';
import { ServerDetailStore } from '../server-detail.store';
import { ServerIconPanel } from './server-icon-panel';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  GAMEMODES,
  GAMEMODE_LABELS,
  LANGUAGES,
  LANGUAGE_LABELS,
  WorldSettings,
  diffWorldSettings,
  toWorldSettings,
  validateWorldSettings,
} from './world-settings';

/** States in which a pod is up, so saved settings wait for the next start. */
const RUNNING_STATES: ReadonlySet<ServerState> = new Set(['STARTING', 'READY', 'CRASHED']);

const DIFFICULTY_OPTIONS: SelectOption[] = DIFFICULTIES.map((value) => ({
  value,
  label: DIFFICULTY_LABELS[value],
}));
const LANGUAGE_OPTIONS: SelectOption[] = LANGUAGES.map((value) => ({
  value,
  label: LANGUAGE_LABELS[value],
}));
const GAMEMODE_OPTIONS: SelectOption[] = GAMEMODES.map((value) => ({
  value,
  label: GAMEMODE_LABELS[value],
}));

@Component({
  selector: 'mc-server-world-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    McBanner,
    ServerIconPanel,
    McButton,
    McPanel,
    McSelect,
    McSwitch,
    McTextField,
  ],
  template: `
    @if (form(); as current) {
      <div class="flex max-w-3xl flex-col gap-6">
        @if (store.server(); as server) {
          <mc-server-icon-panel [serverId]="server.id" />
        }

        @if (pendingRestart()) {
          <mc-banner tone="info" title="Reinicie para aplicar">
            As configurações foram salvas e entram em vigor na próxima vez que o servidor ligar.
          </mc-banner>
        }

        <mc-panel title="Mundo e partida">
          <div class="flex flex-col gap-5">
            <mc-text-field
              label="MOTD (mensagem na lista de servidores)"
              autocomplete="off"
              helpText="Use \\n para quebrar a linha e códigos de cor como §a (verde), §e (amarelo), §7 (cinza) e §l (negrito)."
              [errorText]="errors().motd ?? ''"
              [ngModel]="current.motd"
              (ngModelChange)="set('motd', $event)"
            />
            <mc-select
              label="Idioma das mensagens do gateway"
              hint="O Minecraft não informa o idioma do jogador antes de entrar, então o texto da lista e os avisos de recusa seguem este idioma, igual para todos."
              [options]="languages"
              [value]="current.language"
              (valueChange)="set('language', $event)"
            />
            <div class="grid gap-5 sm:grid-cols-2">
              <mc-select
                label="Dificuldade"
                [options]="difficulties"
                [value]="current.difficulty"
                (valueChange)="set('difficulty', $event)"
              />
              <mc-select
                label="Modo de jogo"
                [options]="gamemodes"
                [value]="current.gamemode"
                (valueChange)="set('gamemode', $event)"
              />
            </div>
            <div class="flex flex-col gap-4">
              <mc-switch
                label="PvP"
                [checked]="current.pvp"
                (checkedChange)="set('pvp', $event)"
              >
                Jogadores podem se atacar.
              </mc-switch>
              <mc-switch
                label="Hardcore"
                [checked]="current.hardcore"
                (checkedChange)="set('hardcore', $event)"
              >
                Uma morte e o jogador vira espectador.
              </mc-switch>
            </div>
          </div>
        </mc-panel>

        <mc-panel title="Limites e desempenho">
          <div class="grid gap-5 sm:grid-cols-2">
            <mc-text-field
              label="Máximo de jogadores"
              inputmode="numeric"
              [errorText]="errors().maxPlayers ?? ''"
              [ngModel]="current.maxPlayers"
              (ngModelChange)="set('maxPlayers', $event)"
            />
            <mc-text-field
              label="Proteção do spawn (blocos)"
              inputmode="numeric"
              [errorText]="errors().spawnProtection ?? ''"
              [ngModel]="current.spawnProtection"
              (ngModelChange)="set('spawnProtection', $event)"
            />
            <mc-text-field
              label="Distância de visão (chunks)"
              inputmode="numeric"
              helpText="De 2 a 32. Valores altos pesam no servidor."
              [errorText]="errors().viewDistance ?? ''"
              [ngModel]="current.viewDistance"
              (ngModelChange)="set('viewDistance', $event)"
            />
            <mc-text-field
              label="Distância de simulação (chunks)"
              inputmode="numeric"
              helpText="De 2 a 32."
              [errorText]="errors().simulationDistance ?? ''"
              [ngModel]="current.simulationDistance"
              (ngModelChange)="set('simulationDistance', $event)"
            />
          </div>
        </mc-panel>

        <mc-panel title="Autenticação">
          <div class="flex flex-col gap-4">
            <mc-switch
              label="Online mode"
              [checked]="current.onlineMode"
              [disabled]="onlineModeLocked()"
              (checkedChange)="set('onlineMode', $event)"
            >
              @if (onlineModeLocked()) {
                Obrigatório enquanto o mundo estiver publicado na internet.
              } @else {
                Desligado (padrão): o gateway já identifica o jogador pelo Tailscale. Ligue só se o
                mundo for publicado na internet.
              }
            </mc-switch>
            <mc-switch
              label="Exigir chat assinado"
              [checked]="current.enforceSecureChat"
              (checkedChange)="set('enforceSecureChat', $event)"
            >
              enforce-secure-chat: sem conta Mojang, deixe desligado.
            </mc-switch>
          </div>
        </mc-panel>

        <div class="flex items-center gap-4">
          <mc-button variant="primary" [disabled]="!canSave()" (click)="save()">
            {{ saving() ? 'Salvando…' : 'Salvar configurações' }}
          </mc-button>
          <p class="t-body-md text-text-muted">
            As mudanças valem na próxima vez que o servidor ligar.
          </p>
        </div>
      </div>
    }
  `,
})
export class ServerWorldPage {
  protected readonly store = inject(ServerDetailStore);
  private readonly serversApi = inject(ServersApi);
  private readonly toast = inject(ToastService);

  protected readonly difficulties = DIFFICULTY_OPTIONS;
  protected readonly gamemodes = GAMEMODE_OPTIONS;
  protected readonly languages = LANGUAGE_OPTIONS;

  protected readonly form = signal<WorldSettings | null>(null);
  protected readonly saving = signal(false);
  protected readonly pendingRestart = signal(false);
  private readonly initial = signal<WorldSettings | null>(null);
  private initialFor: string | null = null;

  protected readonly errors = computed(() => {
    const form = this.form();
    return form ? validateWorldSettings(form) : {};
  });
  private readonly patch = computed(() => {
    const initial = this.initial();
    const form = this.form();
    return initial && form ? diffWorldSettings(initial, form) : {};
  });
  protected readonly canSave = computed(
    () =>
      Object.keys(this.patch()).length > 0 &&
      Object.keys(this.errors()).length === 0 &&
      !this.saving(),
  );
  protected readonly onlineModeLocked = computed(() => this.store.accessPolicy() === 'INTERNET');

  constructor() {
    effect(() => {
      const server = this.store.server();
      if (server?.settings && server.id !== this.initialFor) {
        const settings = server.settings;
        untracked(() => {
          this.initialFor = server.id;
          const loaded = toWorldSettings(settings);
          this.initial.set(loaded);
          this.form.set(loaded);
        });
      }
    });
  }

  protected set<K extends keyof WorldSettings>(key: K, value: WorldSettings[K]): void {
    this.form.update((form) => form && { ...form, [key]: value });
  }

  protected async save(): Promise<void> {
    const server = this.store.server();
    const form = this.form();
    if (!server || !form || !this.canSave()) {
      return;
    }
    this.saving.set(true);
    try {
      await firstValueFrom(this.serversApi.updateSettings(server.id, this.patch()));
    } catch (error) {
      this.toast.error(`Não foi possível salvar as configurações. ${errorReason(error)}`);
      return;
    } finally {
      this.saving.set(false);
    }
    this.initial.set(form);
    this.pendingRestart.set(RUNNING_STATES.has(server.state));
    this.toast.success('Configurações do mundo salvas.');
    this.store.refresh();
  }
}
