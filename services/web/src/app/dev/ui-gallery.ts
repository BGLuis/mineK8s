import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { LogLevel, Modpack, ModpackVersion, ServerState } from '../core/api/models';
import {
  ButtonVariant,
  ConsoleLine,
  DialogService,
  ICONS,
  IconName,
  McBanner,
  McButton,
  McChoiceTile,
  McConsole,
  McDialog,
  McIcon,
  McLegalFooter,
  McMeter,
  McModpackCard,
  McNoApiTag,
  McPanel,
  McProgress,
  McRamSlider,
  McServerCard,
  McSidebar,
  McStatTile,
  McStatusChip,
  McStepper,
  McTable,
  McTabItem,
  McTabs,
  McTextField,
  McVoxelScene,
  ServerCardData,
  ToastService,
} from '../ui';

const SERVER_STATES: ServerState[] = [
  'PROVISIONING',
  'STARTING',
  'READY',
  'STOPPING',
  'STOPPED',
  'UPDATING',
  'CRASHED',
  'FAILED',
];

const BASE_SERVER: Omit<ServerCardData, 'id' | 'state'> = {
  name: 'Sobrevivência',
  subdomain: 'survival.mine.internal',
  server_type: 'PAPER',
  game_version: '1.21.1',
  allocated_memory_mb: 4096,
  is_maintenance: false,
};

const MODPACK: Modpack = {
  id: 'all-the-mods-9',
  name: 'All the Mods 9 - ATM9',
  summary: 'Um dos maiores modpacks de aventura e tecnologia para Minecraft 1.20.1',
  source: 'CURSEFORGE',
  author: 'ATMTeam',
  downloads: 2500000,
};

const MODPACK_VERSION: ModpackVersion = {
  id: 'all-the-mods-9-v1.0.0',
  name: '1.0.0 (Release)',
  gameVersion: '1.20.1',
  loader: 'fabric',
  releaseType: 'release',
  datePublished: '2026-01-15T00:00:00.000Z',
};

/** Development-only catalogue of every UI component and state. Not linked from the navigation. */
@Component({
  selector: 'mc-ui-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    McBanner,
    McButton,
    McChoiceTile,
    McConsole,
    McDialog,
    McIcon,
    McLegalFooter,
    McMeter,
    McModpackCard,
    McNoApiTag,
    McPanel,
    McProgress,
    McRamSlider,
    McServerCard,
    McSidebar,
    McStatTile,
    McStatusChip,
    McStepper,
    McTable,
    McTabs,
    McTextField,
    McVoxelScene,
  ],
  template: `
    <mc-sidebar
      [user]="{ nick: 'Luis', role: 'ADMIN' }"
      [tailnet]="{ used: 12, limit: 50 }"
      [tailnetIsMock]="true"
    />

    <div class="flex min-h-dvh flex-col pt-14 pb-16 md:pt-0 md:pb-0 md:pl-64">
      <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 p-4 md:p-8">
        <header>
          <h1 class="t-display-lg">Galeria de UI</h1>
          <p class="t-body-md text-text-muted">
            Todos os componentes de <code>src/app/ui</code>. Rota apenas de desenvolvimento.
          </p>
        </header>

        <section aria-labelledby="g-type">
          <h2 id="g-type" class="t-title-md mb-4">Tipografia</h2>
          <div class="flex flex-col gap-2">
            <p class="t-display-xl">display-xl Servidores</p>
            <p class="t-display-lg">display-lg Detalhes do mundo</p>
            <p class="t-title-md">title-md Jogadores online</p>
            <p class="t-title-sm">title-sm Configurações rápidas</p>
            <p class="t-button-md">button-md LIGAR SERVIDOR</p>
            <p class="t-button-sm">button-sm Copiar link</p>
            <p class="t-label-md">label-md Subdomínio</p>
            <p class="t-body-lg">body-lg O servidor hiberna após 15 min sem jogadores.</p>
            <p class="t-body-md">body-md Backup criado em 2026-10-02 · 1,2 GB</p>
            <p class="t-body-strong">body-strong pixelmon.mine.internal</p>
            <p class="t-caption">caption ÚLTIMA ATIVIDADE HÁ 3 MIN</p>
            <p class="t-mono-console">mono-console [12:04:51] [INFO]: Steve joined the game</p>
            <p class="t-mono-sm">mono-sm &gt; list</p>
          </div>
        </section>

        <section aria-labelledby="g-bevel">
          <h2 id="g-bevel" class="t-title-md mb-4">Chanfros</h2>
          <div class="flex flex-wrap gap-6 pb-2">
            @for (name of bevels; track name) {
              <div
                class="t-caption flex h-16 w-28 items-center justify-center bg-surface-default"
                [class]="'bevel-' + name"
              >
                bevel-{{ name }}
              </div>
            }
            <div
              class="t-caption border-selected flex h-16 w-28 items-center justify-center bg-surface-default"
            >
              selected
            </div>
          </div>
        </section>

        <section aria-labelledby="g-btn">
          <h2 id="g-btn" class="t-title-md mb-4">Botões</h2>
          <div class="flex flex-col gap-4">
            @for (size of sizes; track size) {
              <div class="flex flex-wrap items-start gap-4">
                @for (variant of variants; track variant) {
                  <mc-button [variant]="variant" [size]="size">{{ variant }}</mc-button>
                }
              </div>
              <div class="flex flex-wrap items-start gap-4">
                <mc-button variant="primary" [size]="size" icon="play">Com ícone</mc-button>
                <mc-button variant="danger" [size]="size" icon="power-off">Parar</mc-button>
                <mc-button [size]="size" [disabled]="true">Desabilitado</mc-button>
                <mc-button variant="warning" [size]="size" [disabled]="true"
                  >Desabilitado</mc-button
                >
                <mc-button [size]="size" icon="settings" ariaLabel="Configurações" />
              </div>
            }
          </div>
        </section>

        <section aria-labelledby="g-icons">
          <h2 id="g-icons" class="t-title-md mb-4">Ícones</h2>
          <ul class="grid grid-cols-3 gap-4 sm:grid-cols-5 md:grid-cols-8">
            @for (name of iconNames; track name) {
              <li
                class="t-caption flex flex-col items-center gap-2 bg-surface-default p-3 text-text-muted"
              >
                <mc-icon [name]="name" [size]="32" class="text-text-primary" />
                {{ name }}
              </li>
            }
          </ul>
        </section>

        <section aria-labelledby="g-chip">
          <h2 id="g-chip" class="t-title-md mb-4">Chips de estado e etiqueta sem API</h2>
          <div class="flex flex-wrap items-center gap-4">
            @for (state of states; track state) {
              <mc-status-chip [state]="state" />
            }
            <mc-status-chip state="MAINTENANCE" />
            <mc-no-api-tag />
            <mc-no-api-tag detail="TPS e JVM" />
          </div>
        </section>

        <section aria-labelledby="g-field">
          <h2 id="g-field" class="t-title-md mb-4">Campos de texto</h2>
          <div class="grid gap-6 md:grid-cols-2">
            <mc-text-field
              label="Nick"
              placeholder="Steve"
              helpText="De 3 a 16 caracteres."
              [formControl]="nick"
            />
            <mc-text-field
              label="Subdomínio"
              placeholder="meu-mundo"
              errorText="Use apenas letras minúsculas, números e hífens."
            />
            <mc-text-field label="Desabilitado" placeholder="Indisponível" [disabled]="true" />
            <mc-text-field
              label="Token de bootstrap"
              type="password"
              helpText="Impresso nos logs do control plane."
            />
          </div>
          <p class="t-body-md mt-2 text-text-muted">
            Valor do formulário: {{ nick.value || '(vazio)' }}
          </p>
        </section>

        <section aria-labelledby="g-panel">
          <h2 id="g-panel" class="t-title-md mb-4">Painel, medidores e progresso</h2>
          <div class="grid gap-6 md:grid-cols-2">
            <mc-panel title="Título do painel">
              <p class="t-body-md text-text-muted">Conteúdo do painel. Troque por instâncias.</p>
              <button
                panelActions
                type="button"
                class="t-button-sm h-10 px-2 text-text-muted hover:text-text-primary"
              >
                Ação
              </button>
            </mc-panel>
            <mc-panel title="Medidores">
              <div class="flex flex-col gap-4">
                @for (value of meterValues; track value) {
                  <mc-meter [label]="'Uso a ' + value" [value]="value" />
                }
              </div>
            </mc-panel>
            <mc-panel title="Progresso">
              <div class="flex flex-col gap-4">
                <mc-progress tone="xp" [percent]="45" step="Baixando mods · 142/316" />
                <mc-progress tone="info" [percent]="72" step="Aplicando overrides" />
                <mc-progress tone="danger" [percent]="100" step="Falha na verificação" />
              </div>
            </mc-panel>
            <mc-panel title="Memória">
              <mc-ram-slider [formControl]="ram" />
              <p class="t-caption mt-2 text-text-muted">Heap selecionado: {{ ram.value }} MB</p>
            </mc-panel>
          </div>
          <div class="mt-6 grid gap-6 sm:grid-cols-3">
            <mc-stat-tile
              label="CPU"
              [value]="42"
              detail="3,1 de 7,4 GHz"
              [noApi]="true"
              noApiDetail="métricas do nó"
            />
            <mc-stat-tile label="RAM" [value]="78" detail="24,9 de 32 GiB" />
            <mc-stat-tile label="NVMe" [value]="93" detail="465 de 500 GB" />
          </div>
        </section>

        <section aria-labelledby="g-banner">
          <h2 id="g-banner" class="t-title-md mb-4">Banners</h2>
          <div class="flex flex-col gap-3">
            <mc-banner tone="warning" title="Disco em 78 %"
              >Acima de 75 % do volume. Apague backups antigos ou aumente o disco.</mc-banner
            >
            <mc-banner tone="danger" title="Disco em 93 %" [dismissible]="true"
              >Novos servidores e modpacks estão bloqueados acima de 85 % do host.</mc-banner
            >
            <mc-banner tone="info" title="Servidor hibernado"
              >Ele acorda sozinho quando alguém tentar entrar (auto-wake).</mc-banner
            >
          </div>
        </section>

        <section aria-labelledby="g-tabs">
          <h2 id="g-tabs" class="t-title-md mb-4">Abas, etapas e escolhas</h2>
          <mc-tabs class="mb-6" [tabs]="tabs" [(active)]="activeTab" />
          <p class="t-body-md mb-6 text-text-muted">Aba ativa: {{ activeTab() }}</p>
          <mc-stepper
            class="mb-6"
            [steps]="['Perfil', 'Tipo', 'Recursos', 'Revisão']"
            [current]="1"
          />
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            @for (option of choices; track option.value) {
              <mc-choice-tile
                name="type"
                [value]="option.value"
                [label]="option.label"
                [description]="option.description"
                [icon]="option.icon"
                [checked]="choice() === option.value"
                (chosen)="choice.set($event)"
              />
            }
          </div>
        </section>

        <section aria-labelledby="g-table">
          <h2 id="g-table" class="t-title-md mb-4">Tabela</h2>
          <div class="bevel-panel overflow-x-auto bg-surface-default">
            <table mc-table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Jogador</th>
                  <th>Status</th>
                  <th class="mc-cell-num">Visto há</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>pc-do-lucas</td>
                  <td>LucasCraft</td>
                  <td><mc-status-chip state="READY" /></td>
                  <td class="mc-cell-num">3 min</td>
                </tr>
                <tr>
                  <td>notebook-ana</td>
                  <td>AnaBuilds</td>
                  <td><mc-status-chip state="STOPPED" /></td>
                  <td class="mc-cell-num">12 dias</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="g-console">
          <h2 id="g-console" class="t-title-md mb-4">Console</h2>
          <mc-console [lines]="consoleLines()" (command)="onCommand($event)" />
        </section>

        <section aria-labelledby="g-feedback">
          <h2 id="g-feedback" class="t-title-md mb-4">Toasts e diálogos</h2>
          <div class="flex flex-wrap gap-4">
            <mc-button variant="primary" size="sm" (click)="toast.success('Servidor iniciado.')"
              >Toast sucesso</mc-button
            >
            <mc-button variant="info" size="sm" (click)="toast.info('Backup em andamento.')"
              >Toast info</mc-button
            >
            <mc-button variant="warning" size="sm" (click)="toast.warning('Disco acima de 75 %.')"
              >Toast aviso</mc-button
            >
            <mc-button
              variant="danger"
              size="sm"
              (click)="toast.error('Falha ao restaurar o backup.')"
              >Toast erro (fixo)</mc-button
            >
            <mc-button size="sm" (click)="restoreOpen.set(true)">Abrir diálogo</mc-button>
            <mc-button size="sm" (click)="confirmViaService()">Confirmar via serviço</mc-button>
          </div>
          <p class="t-body-md mt-2 text-text-muted">
            Última resposta do serviço: {{ lastConfirm() }}
          </p>
          <mc-dialog [(open)]="restoreOpen" title="Restaurar backup?" confirmLabel="Restaurar">
            O servidor precisa estar parado. Antes de restaurar, um backup de segurança
            (PRE_RESTORE) é criado automaticamente e, se algo falhar, o mundo volta ao estado atual.
          </mc-dialog>
        </section>

        <section aria-labelledby="g-scene">
          <h2 id="g-scene" class="t-title-md mb-4">Cena voxel</h2>
          <div class="grid gap-6 sm:grid-cols-3">
            @for (variant of [0, 1, 2]; track variant) {
              <mc-voxel-scene class="w-full" [variant]="variant" />
            }
          </div>
        </section>

        <section aria-labelledby="g-cards">
          <h2 id="g-cards" class="t-title-md mb-4">Cartões de servidor</h2>
          <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            @for (state of states; track state) {
              <mc-server-card
                [server]="serverFor(state)"
                [players]="state === 'READY' ? { online: 2, max: 20 } : null"
                (start)="toast.info('Ligar ' + $event)"
                (stop)="toast.info('Parar ' + $event)"
                (restart)="toast.info('Reiniciar ' + $event)"
                (open)="toast.info('Abrir ' + $event)"
              />
            }
            <mc-server-card [server]="maintenanceServer" />
          </div>
        </section>

        <section aria-labelledby="g-modpack">
          <h2 id="g-modpack" class="t-title-md mb-4">Cartões de modpack</h2>
          <div class="flex flex-col gap-6">
            <mc-modpack-card
              [modpack]="modpack"
              [version]="modpackVersion"
              [selected]="selectedModpack() === false"
              (choose)="selectedModpack.set(false)"
            />
            <mc-modpack-card
              [modpack]="modpack"
              [version]="modpackVersion"
              [selected]="selectedModpack() === true"
              (choose)="selectedModpack.set(true)"
            />
          </div>
        </section>
      </main>
      <mc-legal-footer />
    </div>
  `,
})
export class UiGallery {
  protected readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogService);

  protected readonly bevels = [
    'neutral',
    'light',
    'primary',
    'danger',
    'info',
    'warning',
    'accent',
    'panel',
    'sunken',
    'pressed',
  ];
  protected readonly variants: ButtonVariant[] = [
    'neutral',
    'light',
    'primary',
    'danger',
    'info',
    'warning',
    'accent',
  ];
  protected readonly sizes = ['md', 'sm'] as const;
  protected readonly states = SERVER_STATES;
  protected readonly iconNames = Object.keys(ICONS) as IconName[];
  protected readonly meterValues = [42, 74, 75, 89, 90, 100];
  protected readonly modpack = MODPACK;
  protected readonly modpackVersion = MODPACK_VERSION;
  protected readonly maintenanceServer: ServerCardData = {
    ...BASE_SERVER,
    id: 'srv-maint',
    state: 'READY',
    is_maintenance: true,
  };

  protected readonly nick = new FormControl('');
  protected readonly ram = new FormControl(4096);
  protected readonly tabs: McTabItem[] = [
    { id: 'overview', label: 'Visão geral' },
    { id: 'console', label: 'Console' },
    { id: 'files', label: 'Arquivos' },
  ];
  protected readonly activeTab = signal('overview');
  protected readonly choices: {
    value: string;
    label: string;
    description: string;
    icon: IconName;
  }[] = [
    { value: 'PAPER', label: 'Paper', description: 'Plugins, rápido', icon: 'sword' },
    { value: 'VANILLA', label: 'Vanilla', description: 'Oficial da Mojang', icon: 'grid' },
    { value: 'FABRIC', label: 'Fabric', description: 'Mods leves', icon: 'plant' },
    { value: 'FORGE', label: 'Forge', description: 'Mods clássicos', icon: 'pickaxe' },
  ];
  protected readonly choice = signal('PAPER');
  protected readonly selectedModpack = signal<boolean | null>(true);
  protected readonly restoreOpen = signal(false);
  protected readonly lastConfirm = signal('—');

  protected readonly consoleLines = signal<ConsoleLine[]>([
    line('INFO', 'Starting minecraft server version 1.21.1'),
    line('INFO', 'Done (8.214s)! For help, type "help"'),
    line('INFO', 'Steve joined the game'),
    line('WARN', "Can't keep up! Is the server overloaded? Running 2434ms behind"),
    line('ERROR', 'Exception ticking world'),
  ]);

  protected serverFor(state: ServerState): ServerCardData {
    return { ...BASE_SERVER, id: `srv-${state.toLowerCase()}`, state };
  }

  protected onCommand(command: string): void {
    this.consoleLines.update((lines) => [
      ...lines,
      line('INFO', `> ${command}`),
      line('INFO', 'Comando enviado (simulado).'),
    ]);
  }

  protected async confirmViaService(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Excluir servidor?',
      message: 'Todos os dados do mundo serão removidos. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
    });
    this.lastConfirm.set(confirmed ? 'confirmado' : 'cancelado');
  }
}

function line(level: LogLevel, message: string): ConsoleLine {
  return { timestamp: new Date().toISOString(), level, message };
}
