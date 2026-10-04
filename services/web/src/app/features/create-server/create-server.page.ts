import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';

import { ModpacksApi } from '../../core/api/modpacks.api';
import { Modpack, ModpackVersion, TaskProgress } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { TasksSocket } from '../../core/realtime/tasks-socket';
import {
  McBanner,
  McButton,
  McChoiceTile,
  McIcon,
  McModpackCard,
  McProgress,
  McRamSlider,
  McStatusChip,
  McStepper,
  McTextField,
  McVoxelScene,
  ToastService,
  containerMemoryMb,
  formatGib,
} from '../../ui';
import {
  ACCESS_OPTIONS,
  MESH_DOMAIN,
  PROFILE_OPTIONS,
  ProfileChoice,
  STEP_LABELS,
  STEP_VALIDATORS,
  StepErrors,
  WizardState,
  buildCreateServerDto,
  createServerErrorMessage,
  initialWizardState,
  installErrorMessage,
  loaderToServerType,
  profileLabel,
  progressStepText,
  provisioningSteps,
  slugifySubdomain,
} from './create-server.model';

type ModpackSourceFilter = 'modrinth' | 'curseforge';
type Phase = 'editing' | 'creating' | 'installing' | 'failed';

const STEP_TITLES = ['Perfil do servidor', 'Recursos', 'Rede e acesso', 'Revisar e provisionar'];
const NEXT_LABELS = ['Próximo: recursos', 'Próximo: rede', 'Próximo: revisar'];
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 10;

@Component({
  selector: 'mc-create-server-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    McBanner,
    McButton,
    McChoiceTile,
    McIcon,
    McModpackCard,
    McProgress,
    McRamSlider,
    McStatusChip,
    McStepper,
    McTextField,
    McVoxelScene,
  ],
  template: `
    <div class="mx-auto max-w-4xl">
      <h1 class="t-display-lg">Criar servidor</h1>
      <p class="t-body-lg mt-1 mb-6 text-text-muted">
        Escolha o tipo, a memória e o endereço. Fica pronto em menos de 1 minuto.
      </p>

      <mc-stepper class="mb-6" [steps]="stepLabels" [current]="step()" label="Etapas da criação" />

      <h2 #stepHeading class="t-title-sm mb-4 outline-none" tabindex="-1">
        {{ stepTitle() }}
      </h2>

      @if (provisioning()) {
        <section
          class="bevel-panel has-drop box-border bg-surface-default p-4 md:p-6"
          aria-labelledby="provisioning-title"
          aria-live="polite"
        >
          <div class="flex flex-wrap items-start gap-4">
            <mc-voxel-scene class="size-16 shrink-0 max-sm:hidden" [variant]="0" />
            <div class="min-w-0 flex-1">
              <h3 id="provisioning-title" class="t-title-sm">{{ provisioningTitle() }}</h3>
              <p class="t-caption mt-1 text-text-muted">{{ summaryLine() }}</p>
            </div>
            <mc-status-chip [state]="phase() === 'failed' ? 'FAILED' : 'PROVISIONING'" />
          </div>

          @if (isModpack()) {
            <mc-progress
              class="mt-6"
              [percent]="progress()?.progressPercent ?? 0"
              [tone]="phase() === 'failed' ? 'danger' : 'xp'"
              [step]="progressText()"
            />
            <ul class="t-body-md mt-4 space-y-1">
              @for (item of checklist(); track item.status) {
                <li
                  class="flex items-center gap-2"
                  [class]="item.state === 'pending' ? 'text-text-disabled' : 'text-text-primary'"
                >
                  <span class="inline-flex w-4 justify-center" aria-hidden="true">
                    @switch (item.state) {
                      @case ('done') {
                        <mc-icon class="text-status-success" name="check" [size]="16" />
                      }
                      @case ('current') {
                        <mc-icon class="text-status-warning" name="chevron" [size]="16" />
                      }
                      @case ('failed') {
                        <mc-icon class="text-status-danger" name="close" [size]="16" />
                      }
                      @default {
                        <span>·</span>
                      }
                    }
                  </span>
                  <span>{{ item.label }}</span>
                  <span class="sr-only">
                    {{
                      item.state === 'done'
                        ? '(concluído)'
                        : item.state === 'current'
                          ? '(em andamento)'
                          : item.state === 'failed'
                            ? '(falhou)'
                            : '(pendente)'
                    }}
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="t-body-md mt-6 text-text-muted" role="status">Criando o servidor…</p>
          }

          @if (failure()) {
            <mc-banner class="mt-6" tone="danger" title="Algo deu errado">
              {{ failure() }}
            </mc-banner>
          }

          <p class="t-caption mt-6 text-text-muted">
            Pode sair desta tela: a instalação continua em segundo plano e o servidor aparece no
            Dashboard.
          </p>

          @if (phase() === 'failed') {
            <div class="mt-6 flex flex-wrap justify-end gap-4">
              @if (createdId()) {
                <mc-button variant="light" (click)="openServer()">Abrir servidor</mc-button>
              } @else {
                <mc-button variant="light" (click)="backToEditing()">Voltar e ajustar</mc-button>
              }
              <mc-button variant="primary" (click)="retry()">Tentar novamente</mc-button>
            </div>
          }
        </section>
      } @else {
        @switch (step()) {
          @case (0) {
            <section class="space-y-6" aria-label="Perfil do servidor">
              <div>
                <div class="mb-2 flex flex-wrap items-center gap-3">
                  <h3 id="profile-label" class="t-label-md">Tipo de servidor</h3>
                </div>
                <div
                  class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                  role="radiogroup"
                  aria-labelledby="profile-label"
                >
                  @for (option of profileOptions; track option.value) {
                    <mc-choice-tile
                      name="server-profile"
                      [value]="option.value"
                      [label]="option.label"
                      [description]="option.description"
                      [icon]="option.icon"
                      [checked]="state().profile === option.value"
                      (chosen)="chooseProfile($event)"
                    />
                  }
                </div>
                @if (errors()['profile']) {
                  <p class="t-caption mt-2 text-status-danger" role="alert">
                    {{ errors()['profile'] }}
                  </p>
                }
              </div>

              @if (isModpack()) {
                <div class="space-y-4">
                  <div class="flex flex-wrap items-center gap-3">
                    <h3 class="t-label-md">Buscar modpack</h3>
                  </div>

                  <div class="flex flex-wrap items-end gap-4">
                    <mc-text-field
                      class="min-w-60 flex-1"
                      label="Nome do modpack"
                      type="search"
                      placeholder="Ex.: all the mods"
                      autocomplete="off"
                      [ngModel]="query()"
                      (ngModelChange)="onQueryChange($event)"
                    />
                    <div class="flex gap-0" role="group" aria-label="Origem do modpack">
                      <mc-button
                        [variant]="source() === 'modrinth' ? 'light' : 'neutral'"
                        [ariaLabel]="'Modrinth' + (source() === 'modrinth' ? ' (selecionado)' : '')"
                        (click)="onSourceChange('modrinth')"
                      >
                        Modrinth
                      </mc-button>
                      <mc-button
                        [variant]="source() === 'curseforge' ? 'light' : 'neutral'"
                        [ariaLabel]="
                          'CurseForge' + (source() === 'curseforge' ? ' (selecionado)' : '')
                        "
                        (click)="onSourceChange('curseforge')"
                      >
                        CurseForge
                      </mc-button>
                    </div>
                  </div>

                  <div aria-live="polite" class="space-y-4">
                    @if (searching()) {
                      <p class="t-body-md text-text-muted">Buscando modpacks…</p>
                    } @else if (searchError()) {
                      <mc-banner tone="danger" title="Falha na busca">
                        Não foi possível buscar modpacks agora. Tente de novo em instantes.
                      </mc-banner>
                    } @else if (results().length === 0) {
                      <p class="t-body-md text-text-muted">
                        Nenhum modpack encontrado para essa busca.
                      </p>
                    }
                    @for (pack of results(); track pack.id) {
                      <mc-modpack-card
                        [modpack]="pack"
                        [version]="state().modpack?.id === pack.id ? state().modpackVersion : null"
                        [selected]="state().modpack?.id === pack.id"
                        (choose)="chooseModpack($event)"
                      />
                    }
                  </div>
                  @if (errors()['modpack']) {
                    <p class="t-caption text-status-danger" role="alert">
                      {{ errors()['modpack'] }}
                    </p>
                  }

                  @if (state().modpack) {
                    <div>
                      <label class="t-label-md mb-1 block" for="modpack-version">
                        Versão do modpack
                      </label>
                      <div class="relative">
                        <select
                          id="modpack-version"
                          class="bevel-sunken t-body-lg h-12 w-full appearance-none bg-surface-input px-3 pr-12 text-text-primary"
                          [disabled]="versionsLoading() || versions().length === 0"
                          [attr.aria-invalid]="errors()['modpackVersion'] ? 'true' : null"
                          [attr.aria-describedby]="'modpack-version-help'"
                          (change)="chooseVersion($any($event.target).value)"
                        >
                          @if (versionsLoading()) {
                            <option value="">Carregando versões…</option>
                          }
                          @for (version of versions(); track version.id) {
                            <option
                              [value]="version.id"
                              [selected]="state().modpackVersion?.id === version.id"
                            >
                              {{ versionLabel(version) }}
                            </option>
                          }
                        </select>
                        <mc-icon
                          class="pointer-events-none absolute top-3 right-3"
                          name="chevron-down"
                          [size]="24"
                        />
                      </div>
                      @if (errors()['modpackVersion']) {
                        <p class="t-caption mt-1 text-status-danger" role="alert">
                          {{ errors()['modpackVersion'] }}
                        </p>
                      } @else {
                        <p id="modpack-version-help" class="t-caption mt-1 text-text-muted">
                          O loader é resolvido automaticamente a partir da versão.
                        </p>
                      }
                    </div>
                  }
                </div>
              } @else if (state().profile) {
                <mc-text-field
                  class="max-w-sm"
                  label="Versão do Minecraft"
                  placeholder="1.21.1"
                  autocomplete="off"
                  [ngModel]="state().gameVersion"
                  (ngModelChange)="patch({ gameVersion: $event })"
                  [errorText]="errors()['gameVersion'] ?? ''"
                />
              }
            </section>
          }

          @case (1) {
            <section class="space-y-6" aria-label="Recursos">
              <mc-ram-slider
                [ngModel]="state().memoryMb"
                (ngModelChange)="patch({ memoryMb: $event })"
              />
              @if (errors()['memory']) {
                <p class="t-caption text-status-danger" role="alert">{{ errors()['memory'] }}</p>
              }

              <mc-text-field
                class="max-w-sm"
                label="Hibernar após (minutos)"
                type="number"
                inputmode="numeric"
                helpText="0 desativa a hibernação. Máximo de 1440 minutos (24 h)."
                [ngModel]="sleepInput()"
                (ngModelChange)="onSleepChange($event)"
                [errorText]="errors()['sleep'] ?? ''"
              />

              <div class="flex items-start gap-4">
                <button
                  type="button"
                  role="switch"
                  id="auto-wake"
                  class="bevel-sunken relative h-10 w-16 shrink-0 bg-surface-input"
                  [attr.aria-checked]="state().autoWake"
                  aria-labelledby="auto-wake-label"
                  (click)="patch({ autoWake: !state().autoWake })"
                >
                  <span
                    class="absolute top-2 size-6 border-2 border-border-strong"
                    [class]="
                      state().autoWake ? 'right-2 bg-action-primary' : 'left-2 bg-surface-hover'
                    "
                  ></span>
                </button>
                <div>
                  <label id="auto-wake-label" for="auto-wake" class="t-label-md block">
                    Acordar automaticamente
                  </label>
                  <p class="t-caption text-text-muted">
                    Liga o servidor quando um jogador tenta entrar enquanto ele hiberna.
                  </p>
                </div>
              </div>
            </section>
          }

          @case (2) {
            <section class="space-y-6" aria-label="Rede e acesso">
              <mc-text-field
                label="Nome do servidor"
                placeholder="Sobrevivência"
                autocomplete="off"
                [maxlength]="100"
                [ngModel]="state().name"
                (ngModelChange)="onNameChange($event)"
                [errorText]="errors()['name'] ?? ''"
              />
              <mc-text-field
                label="Endereço (subdomínio)"
                placeholder="sobrevivencia"
                autocomplete="off"
                [maxlength]="63"
                [ngModel]="state().subdomain"
                (ngModelChange)="onSubdomainChange($event)"
                [helpText]="addressPreview()"
                [errorText]="errors()['subdomain'] ?? ''"
              />

              <div>
                <h3 id="access-label" class="t-label-md mb-2">Quem pode entrar</h3>
                <div
                  class="grid grid-cols-1 gap-4 sm:grid-cols-3"
                  role="radiogroup"
                  aria-labelledby="access-label"
                >
                  @for (option of accessOptions; track option.value) {
                    <mc-choice-tile
                      name="access-policy"
                      [value]="option.value"
                      [label]="option.label"
                      [description]="option.description"
                      [checked]="state().accessPolicy === option.value"
                      (chosen)="patch({ accessPolicy: $any($event) })"
                    />
                  }
                </div>
                <p class="t-caption mt-3 text-text-muted">
                  Para abrir o servidor à internet, use "Publicar" nos detalhes do servidor depois
                  de criá-lo.
                </p>
              </div>
            </section>
          }

          @case (3) {
            <section aria-label="Revisão">
              <dl
                class="bevel-panel has-drop box-border grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 bg-surface-default p-4 md:p-6"
              >
                @for (row of summaryRows(); track row.label) {
                  <dt class="t-caption self-center text-text-muted uppercase">{{ row.label }}</dt>
                  <dd class="t-body-lg min-w-0 break-words">{{ row.value }}</dd>
                }
              </dl>
              @if (submitError()) {
                <mc-banner class="mt-6" tone="danger" title="Não foi possível criar">
                  {{ submitError() }}
                </mc-banner>
              }
            </section>
          }
        }

        <div class="mt-8 flex flex-wrap justify-end gap-4">
          @if (step() === 0) {
            <mc-button variant="light" (click)="cancel()">Cancelar</mc-button>
          } @else {
            <mc-button variant="neutral" (click)="back()">Voltar</mc-button>
          }
          @if (step() < 3) {
            <mc-button variant="primary" icon="play" (click)="next()">
              {{ nextLabel() }}
            </mc-button>
          } @else {
            <mc-button variant="primary" icon="plus" (click)="submit()">Criar servidor</mc-button>
          }
        </div>
      }
    </div>
  `,
})
export class CreateServerPage {
  private readonly servers = inject(ServersApi);
  private readonly modpacks = inject(ModpacksApi);
  private readonly tasks = inject(TasksSocket);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private readonly search$ = new Subject<void>();
  private versionsRequest: Subscription | null = null;
  private taskSubscription: Subscription | null = null;
  private lastStatus = 'QUEUED';
  private subdomainTouched = false;

  protected readonly stepLabels = STEP_LABELS;
  protected readonly profileOptions = PROFILE_OPTIONS;
  protected readonly accessOptions = ACCESS_OPTIONS;

  protected readonly state = signal<WizardState>(initialWizardState());
  protected readonly step = signal(0);
  protected readonly showErrors = signal(false);
  protected readonly phase = signal<Phase>('editing');
  protected readonly submitError = signal('');
  protected readonly failure = signal('');
  protected readonly createdId = signal<string | null>(null);
  protected readonly progress = signal<TaskProgress | null>(null);
  protected readonly failedAt = signal('QUEUED');
  protected readonly sleepInput = signal('15');

  protected readonly query = signal('');
  protected readonly source = signal<ModpackSourceFilter>('modrinth');
  protected readonly results = signal<Modpack[]>([]);
  protected readonly searching = signal(false);
  protected readonly searchError = signal(false);
  protected readonly versions = signal<ModpackVersion[]>([]);
  protected readonly versionsLoading = signal(false);

  protected readonly provisioning = computed(() => this.phase() !== 'editing');
  protected readonly isModpack = computed(() => this.state().profile === 'MODPACK');
  protected readonly stepTitle = computed(() =>
    this.provisioning() ? 'Provisionando' : STEP_TITLES[this.step()],
  );
  protected readonly nextLabel = computed(() => NEXT_LABELS[this.step()] ?? 'Próximo');
  protected readonly errors = computed<StepErrors>(() => {
    const validate = STEP_VALIDATORS[this.step()];
    return this.showErrors() && validate ? validate(this.state()) : {};
  });
  protected readonly addressPreview = computed(
    () => `Endereço de acesso: ${this.state().subdomain || 'seu-servidor'}.${MESH_DOMAIN}`,
  );
  protected readonly checklist = computed(() =>
    provisioningSteps(this.progress()?.status ?? 'QUEUED', this.failedAt()),
  );
  protected readonly progressText = computed(() => progressStepText(this.progress()));
  protected readonly provisioningTitle = computed(() => {
    const { modpack, name } = this.state();
    return this.isModpack() && modpack ? `Montando "${modpack.name}"` : `Criando "${name.trim()}"`;
  });
  protected readonly summaryLine = computed(() => {
    const s = this.state();
    const type = this.serverTypeLabel();
    return `${s.subdomain}.${MESH_DOMAIN} · ${formatGib(s.memoryMb)} heap (${formatGib(containerMemoryMb(s.memoryMb))} no contêiner) · ${type}`;
  });
  protected readonly summaryRows = computed(() => {
    const s = this.state();
    const rows = [
      { label: 'Tipo', value: this.isModpack() ? 'Modpack' : profileLabel(s) },
      { label: 'Versão do Minecraft', value: this.gameVersion() },
    ];
    if (this.isModpack() && s.modpack && s.modpackVersion) {
      rows.push({
        label: 'Modpack',
        value: `${s.modpack.name} · ${s.modpackVersion.name} (${s.modpackVersion.loader})`,
      });
    }
    rows.push(
      {
        label: 'Memória',
        value: `${formatGib(s.memoryMb)} de heap (${formatGib(containerMemoryMb(s.memoryMb))} no contêiner)`,
      },
      {
        label: 'Hibernação',
        value:
          s.sleepTimeoutMinutes === 0
            ? 'Desativada'
            : `Após ${s.sleepTimeoutMinutes} min sem jogadores`,
      },
      { label: 'Acordar automático', value: s.autoWake ? 'Ligado' : 'Desligado' },
      { label: 'Nome', value: s.name.trim() },
      { label: 'Endereço', value: `${s.subdomain}.${MESH_DOMAIN}` },
      {
        label: 'Acesso',
        value: ACCESS_OPTIONS.find((o) => o.value === s.accessPolicy)?.label ?? '',
      },
    );
    return rows;
  });

  constructor() {
    this.search$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        tap(() => {
          this.searching.set(true);
          this.searchError.set(false);
        }),
        switchMap(() =>
          this.modpacks
            .search(this.query().trim(), { source: this.source(), limit: SEARCH_LIMIT })
            .pipe(
              map((response) => response.results),
              catchError(() => {
                this.searchError.set(true);
                return of<Modpack[]>([]);
              }),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.results.set(results);
        this.searching.set(false);
      });

    this.destroyRef.onDestroy(() => {
      this.versionsRequest?.unsubscribe();
      this.taskSubscription?.unsubscribe();
    });
  }

  protected patch(partial: Partial<WizardState>): void {
    this.state.update((current) => ({ ...current, ...partial }));
  }

  protected onSleepChange(value: string): void {
    this.sleepInput.set(value);
    this.patch({ sleepTimeoutMinutes: value.trim() === '' ? Number.NaN : Number(value) });
  }

  protected chooseProfile(value: string): void {
    const profile = value as ProfileChoice;
    this.patch({ profile });
    if (profile === 'MODPACK' && this.results().length === 0) {
      this.search$.next();
    }
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    this.search$.next();
  }

  protected onSourceChange(source: ModpackSourceFilter): void {
    this.source.set(source);
    this.search$.next();
  }

  protected chooseModpack(id: string): void {
    const modpack = this.results().find((pack) => pack.id === id);
    if (!modpack || this.state().modpack?.id === id) {
      return;
    }
    this.patch({ modpack, modpackVersion: null });
    this.versions.set([]);
    this.versionsLoading.set(true);
    this.versionsRequest?.unsubscribe();
    this.versionsRequest = this.modpacks
      .versions(modpack.id, modpack.source.toLowerCase())
      .pipe(catchError(() => of<ModpackVersion[]>([])))
      .subscribe((versions) => {
        const sorted = [...versions].sort(
          (a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished),
        );
        this.versions.set(sorted);
        this.versionsLoading.set(false);
        this.patch({ modpackVersion: sorted[0] ?? null });
      });
  }

  protected chooseVersion(id: string): void {
    this.patch({ modpackVersion: this.versions().find((version) => version.id === id) ?? null });
  }

  protected versionLabel(version: ModpackVersion): string {
    return `${version.name} · Minecraft ${version.gameVersion} · ${version.loader}`;
  }

  protected onNameChange(name: string): void {
    this.patch({
      name,
      subdomain: this.subdomainTouched ? this.state().subdomain : slugifySubdomain(name),
    });
  }

  protected onSubdomainChange(subdomain: string): void {
    this.subdomainTouched = true;
    this.patch({ subdomain: subdomain.toLowerCase() });
  }

  protected next(): void {
    const validate = STEP_VALIDATORS[this.step()];
    if (Object.keys(validate(this.state())).length > 0) {
      this.showErrors.set(true);
      return;
    }
    this.goTo(this.step() + 1);
  }

  protected back(): void {
    this.submitError.set('');
    this.goTo(this.step() - 1);
  }

  protected cancel(): void {
    void this.router.navigate(['/']);
  }

  protected backToEditing(): void {
    this.phase.set('editing');
    this.failure.set('');
  }

  protected submit(): void {
    if (this.phase() !== 'editing') {
      return;
    }
    this.submitError.set('');
    this.phase.set('creating');
    this.servers.create(buildCreateServerDto(this.state())).subscribe({
      next: ({ id }) => {
        this.createdId.set(id);
        if (this.isModpack()) {
          this.install(id);
        } else {
          this.toast.success('Servidor criado.');
          this.openServer();
        }
      },
      error: (error) => {
        this.phase.set('editing');
        this.submitError.set(createServerErrorMessage(error));
      },
    });
  }

  protected retry(): void {
    const id = this.createdId();
    if (id) {
      this.install(id);
    } else {
      this.phase.set('editing');
      this.submit();
    }
  }

  protected openServer(): void {
    const id = this.createdId();
    if (id) {
      void this.router.navigate(['/servers', id]);
    }
  }

  private install(serverId: string): void {
    const { modpack, modpackVersion } = this.state();
    if (!modpack || !modpackVersion) {
      return;
    }
    this.phase.set('installing');
    this.failure.set('');
    this.progress.set(null);
    this.lastStatus = 'QUEUED';
    this.failedAt.set('QUEUED');
    this.taskSubscription?.unsubscribe();

    this.modpacks
      .install(serverId, {
        source: modpack.source,
        projectId: modpack.id,
        versionId: modpackVersion.id,
      })
      .subscribe({
        next: ({ taskId }) => this.watch(taskId),
        error: (error) => this.fail(installErrorMessage(error)),
      });
  }

  private watch(taskId: string): void {
    this.taskSubscription = this.tasks.progress(taskId).subscribe((update) => {
      this.progress.set(update);
      if (update.status === 'FAILED') {
        this.fail(update.currentStep || 'A instalação do modpack falhou.');
      } else if (update.status === 'COMPLETED') {
        this.toast.success('Modpack instalado. Servidor pronto.');
        this.openServer();
      } else {
        this.lastStatus = update.status;
      }
    });
  }

  private fail(message: string): void {
    this.failedAt.set(this.lastStatus);
    this.failure.set(message);
    this.phase.set('failed');
  }

  private goTo(step: number): void {
    this.showErrors.set(false);
    this.step.set(step);
    afterNextRender(() => this.stepHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  private gameVersion(): string {
    const { modpackVersion, gameVersion } = this.state();
    return this.isModpack() ? (modpackVersion?.gameVersion ?? '') : gameVersion.trim();
  }

  private serverTypeLabel(): string {
    const { modpackVersion } = this.state();
    const type = this.isModpack()
      ? modpackVersion && loaderToServerType(modpackVersion.loader)
      : this.state().profile;
    const label = PROFILE_OPTIONS.find((option) => option.value === type)?.label ?? '';
    return `${label} ${this.gameVersion()}`.trim();
  }
}
