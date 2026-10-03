import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Directive,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';

import { ClaimResult, InviteSummary, TailscaleApi } from '../../core/api';
import {
  McBanner,
  McButton,
  McLegalFooter,
  McTextField,
  McVoxelScene,
  ToastService,
} from '../../ui';
import { copyToClipboard, focusFirstInvalid, formatDateTime, formatShortDate } from '../access/format';
import { apiErrorMessage } from './api-error';
import { TAILSCALE_DOWNLOADS, isTailscaleDeepLink, maskAuthKey } from './auth-key';
import { InviteErrorView, MISSING_TOKEN_VIEW, inviteErrorView } from './invite-error';
import { NICK_HELP, validateNick } from './nick';

const REAL_NAME_MIN = 2;
const REAL_NAME_MAX = 100;

type JoinState =
  | { kind: 'loading' }
  | { kind: 'error'; view: InviteErrorView }
  | { kind: 'form'; invite: InviteSummary }
  | { kind: 'done'; result: ClaimResult };

/** Anchor styled like `mc-button` (external download links are navigation, not actions). */
@Directive({
  selector: 'a[mcLinkButton]',
  host: {
    class:
      'bevel-info t-button-md inline-flex h-14 w-full items-center justify-center bg-action-info px-6 text-text-primary',
  },
})
export class LinkButton {}

@Component({
  selector: 'mc-join-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, McBanner, McButton, McLegalFooter, McTextField, McVoxelScene, LinkButton],
  template: `
    <div class="relative isolate flex min-h-dvh flex-col bg-bg-canvas md:bg-scene-sky">
      <div class="absolute inset-0 -z-10 hidden md:block">
        <mc-voxel-scene class="h-full w-full aspect-auto!" [variant]="2" />
      </div>
      <div class="h-36 shrink-0 md:hidden">
        <mc-voxel-scene class="h-full w-full aspect-auto!" [variant]="0" />
      </div>

      <main class="flex flex-1 justify-center p-4 md:items-center md:p-8">
        <div
          class="w-full md:max-w-lg md:border-4 md:border-border-strong md:bg-surface-default md:p-8 md:shadow-[0_8px_0_var(--bevel-panel-drop)]"
        >
          @switch (state().kind) {
            @case ('loading') {
              <div class="flex flex-col gap-3" role="status" aria-label="Verificando convite">
                <h1 class="t-title-md" tabindex="-1">Verificando convite…</h1>
                <div class="h-5 animate-pulse bg-surface-hover"></div>
                <div class="h-20 animate-pulse bg-surface-hover"></div>
              </div>
            }
            @case ('error') {
              @if (errorView(); as view) {
                <div class="flex flex-col gap-4">
                  <h1 class="t-title-md" tabindex="-1">{{ view.title }}</h1>
                  <mc-banner tone="danger" title="Não foi possível usar este link">
                    {{ view.text }}
                  </mc-banner>
                  @if (view.retryable) {
                    <mc-button variant="primary" [block]="true" (click)="retry()">
                      Tentar de novo
                    </mc-button>
                  }
                </div>
              }
            }
            @case ('form') {
              @if (invite(); as current) {
                <form
                  #claimForm
                  class="flex flex-col gap-4"
                  novalidate
                  (ngSubmit)="claim(claimForm)"
                >
                  <h1 class="t-title-md" tabindex="-1">Você foi convidado!</h1>
                  <p class="t-body-lg text-text-muted">
                    Um administrador chamou você para jogar nos servidores dele. Preencha abaixo e
                    siga 3 passos rápidos.
                  </p>
                  <div class="border-l-4 border-status-success bg-bg-sunken p-3">
                    <p class="t-label-md break-words text-status-success">{{ current.name }}</p>
                    <p class="t-body-md mt-1">{{ inviteSummary(current) }}</p>
                  </div>
                  <mc-text-field
                    label="Seu nome"
                    placeholder="Como seus amigos chamam você"
                    autocomplete="name"
                    [maxlength]="realNameMax"
                    [errorText]="visibleNameError()"
                    [ngModel]="realName()"
                    (ngModelChange)="realName.set($event)"
                    [ngModelOptions]="{ standalone: true }"
                  />
                  <mc-text-field
                    label="Seu nick no Minecraft"
                    placeholder="Ex.: LucasCraft"
                    autocomplete="off"
                    [maxlength]="16"
                    [helpText]="nickHelp"
                    [errorText]="visibleNickError()"
                    [ngModel]="nick()"
                    (ngModelChange)="nick.set($event)"
                    [ngModelOptions]="{ standalone: true }"
                  />
                  @if (claimError()) {
                    <mc-banner tone="danger" title="Não foi possível entrar na rede">
                      {{ claimError() }}
                    </mc-banner>
                  }
                  <mc-button
                    type="submit"
                    variant="primary"
                    icon="play"
                    [block]="true"
                    [disabled]="claiming()"
                  >
                    {{ claiming() ? 'Criando seu acesso…' : 'Entrar na rede' }}
                  </mc-button>
                  <ol class="m-0 grid list-none grid-cols-3 gap-2 p-0">
                    @for (step of previewSteps; track step.number) {
                      <li class="border-2 border-border-strong bg-bg-sunken p-3">
                        <span class="t-label-md text-status-warning">{{ step.number }}</span>
                        <p class="t-caption mt-1">{{ step.label }}</p>
                      </li>
                    }
                  </ol>
                </form>
              }
            }
            @case ('done') {
              @if (result(); as done) {
                <div class="flex flex-col gap-4">
                  <h1 class="t-title-md break-words text-status-success" tabindex="-1">
                    Tudo pronto, {{ firstName(done.realName) }}!
                  </h1>
                  <p class="t-body-lg text-text-muted">
                    Sua vaga na rede foi criada. Faça os 3 passos abaixo neste aparelho ou no
                    computador onde vai jogar.
                  </p>

                  <section class="step" aria-labelledby="step-1">
                    <h2 id="step-1" class="t-label-md"><span class="num">1</span> Instale o Tailscale</h2>
                    <p class="t-body-md mt-2 text-text-muted">
                      App gratuito para Windows, macOS, Linux, Android e iOS.
                    </p>
                    <span class="has-drop mt-3 block">
                      <a
                        mcLinkButton
                        href="https://tailscale.com/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        >Baixar Tailscale</a
                      >
                    </span>
                    <ul class="m-0 mt-1 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                      @for (os of downloads; track os.label) {
                        <li>
                          <a
                            class="t-caption inline-flex min-h-10 items-center text-status-info underline"
                            [href]="os.href"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ os.label }}</a
                          >
                        </li>
                      }
                    </ul>
                  </section>

                  <section class="step" aria-labelledby="step-2">
                    <h2 id="step-2" class="t-label-md"><span class="num">2</span> Entre na rede</h2>
                    <p class="t-body-md mt-2 text-text-muted">
                      Toque no link mágico. Se não abrir, cole a chave no app do Tailscale.
                    </p>
                    <div class="mt-3">
                      <mc-button
                        variant="primary"
                        [block]="true"
                        [disabled]="!canOpenDeepLink()"
                        (click)="openDeepLink()"
                      >
                        Abrir link mágico
                      </mc-button>
                    </div>
                    <div class="mt-1 flex items-center gap-2 bg-bg-sunken p-2">
                      <code
                        class="t-body-strong min-w-0 flex-1 break-all pl-1"
                        aria-label="Chave de acesso, parcialmente oculta"
                        >{{ maskedKey() }}</code
                      >
                      <mc-button size="sm" (click)="copyKey()">Copiar</mc-button>
                    </div>
                    <p class="t-caption mt-2 text-status-warning">
                      A chave vale até {{ keyExpiry() }}. Ela só aparece agora: não feche esta página
                      antes de entrar.
                    </p>
                  </section>

                  <section class="step" aria-labelledby="step-3">
                    <h2 id="step-3" class="t-label-md"><span class="num">3</span> Abra o Minecraft</h2>
                    <p class="t-body-md mt-2 text-text-muted">
                      Multijogador → Adicionar servidor →
                      @if (done.tailcatTunnel; as tunnel) {
                        <strong class="break-words text-text-primary">{{ tunnel.serverAddress }}</strong>
                      } @else {
                        o endereço que o administrador passou
                      }
                    </p>
                    @if (done.tailcatTunnel; as tunnel) {
                      <p class="t-caption mt-2 text-text-muted">{{ tunnel.instructions }}</p>
                    }
                  </section>
                </div>
              }
            }
          }
        </div>
      </main>

      <mc-legal-footer class="relative" />
    </div>
  `,
  styles: `
    h1[tabindex='-1']:focus {
      outline: none;
    }
    .step {
      border: 2px solid var(--color-border-strong);
      background-color: var(--color-surface-default);
      padding: 16px;
    }
    @media (min-width: 768px) {
      .step {
        background-color: var(--color-bg-sunken);
      }
    }
    .num {
      color: var(--color-status-warning);
      margin-right: 8px;
    }
  `,
})
export class JoinPage {
  private readonly api = inject(TailscaleApi);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** `?token=` from the invite link, bound by withComponentInputBinding. */
  readonly token = input<string>();

  protected readonly state = signal<JoinState>({ kind: 'loading' });
  protected readonly invite = computed(() => {
    const state = this.state();
    return state.kind === 'form' ? state.invite : null;
  });
  protected readonly result = computed(() => {
    const state = this.state();
    return state.kind === 'done' ? state.result : null;
  });
  protected readonly errorView = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.view : null;
  });

  protected readonly realName = signal('');
  protected readonly nick = signal('');
  protected readonly claiming = signal(false);
  protected readonly claimError = signal('');
  private readonly submitted = signal(false);
  private readonly reloads = signal(0);

  protected readonly nickHelp = NICK_HELP;
  protected readonly realNameMax = REAL_NAME_MAX;
  protected readonly downloads = TAILSCALE_DOWNLOADS;
  protected readonly previewSteps = [
    { number: 1, label: 'Instale o Tailscale' },
    { number: 2, label: 'Abra o link mágico' },
    { number: 3, label: 'Entre no Minecraft' },
  ];

  private readonly nameError = computed(() => {
    const length = this.realName().trim().length;
    return length < REAL_NAME_MIN || length > REAL_NAME_MAX
      ? `Informe seu nome (${REAL_NAME_MIN} a ${REAL_NAME_MAX} caracteres).`
      : '';
  });
  private readonly nickError = computed(() => validateNick(this.nick()) ?? '');
  protected readonly visibleNameError = computed(() => (this.submitted() ? this.nameError() : ''));
  protected readonly visibleNickError = computed(() => (this.submitted() ? this.nickError() : ''));

  /** Shown in full only when the clipboard is blocked, so the key can still be copied by hand. */
  private readonly keyRevealed = signal(false);
  protected readonly maskedKey = computed(() => {
    const key = this.result()?.authKey ?? '';
    return this.keyRevealed() ? key : maskAuthKey(key);
  });
  protected readonly keyExpiry = computed(() => {
    const expiresAt = this.result()?.expiresAt;
    return expiresAt ? formatDateTime(expiresAt) : '';
  });
  protected readonly canOpenDeepLink = computed(() =>
    isTailscaleDeepLink(this.result()?.deepLinkUrl ?? ''),
  );

  constructor() {
    combineLatest([toObservable(this.token), toObservable(this.reloads)])
      .pipe(
        switchMap(([token]) => {
          if (!token) {
            return of<JoinState>({ kind: 'error', view: MISSING_TOKEN_VIEW });
          }
          return this.api.validateInvite(token).pipe(
            map((invite): JoinState => ({ kind: 'form', invite })),
            catchError((error: unknown) =>
              of<JoinState>({ kind: 'error', view: inviteErrorView(error) }),
            ),
            startWith<JoinState>({ kind: 'loading' }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));

    // Moves keyboard and screen reader focus to the new heading when the card changes.
    effect(() => {
      this.state();
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus());
    });
  }

  protected retry(): void {
    this.reloads.update((count) => count + 1);
  }

  protected inviteSummary(invite: InviteSummary): string {
    const parts: string[] = [];
    const servers = invite.serverIds.length;
    if (servers > 0) {
      parts.push(`Acesso a ${servers} ${servers === 1 ? 'servidor' : 'servidores'}`);
    }
    const remaining = Math.max(invite.maxUses - invite.usedCount, 0);
    parts.push(`${remaining} ${remaining === 1 ? 'uso restante' : 'usos restantes'}`);
    parts.push(`expira em ${formatShortDate(invite.expiresAt)}`);
    return parts.join(' · ');
  }

  protected firstName(realName: string): string {
    return realName.trim().split(/\s+/)[0] ?? '';
  }

  protected claim(form: HTMLElement): void {
    this.submitted.set(true);
    this.claimError.set('');
    const token = this.token();
    if (!token || this.nameError() || this.nickError()) {
      focusFirstInvalid(form);
      return;
    }
    this.claiming.set(true);
    this.api
      .claim({ token, realName: this.realName().trim(), minecraftNick: this.nick().trim() })
      .subscribe({
        next: (result) => {
          this.claiming.set(false);
          this.state.set({ kind: 'done', result });
        },
        error: (error: unknown) => {
          this.claiming.set(false);
          this.claimError.set(
            apiErrorMessage(error, 'Confira os dados e tente de novo em instantes.'),
          );
        },
      });
  }

  protected openDeepLink(): void {
    const url = this.result()?.deepLinkUrl ?? '';
    if (isTailscaleDeepLink(url)) {
      window.location.assign(url);
    }
  }

  protected async copyKey(): Promise<void> {
    const key = this.result()?.authKey;
    if (key && (await copyToClipboard(key))) {
      this.toast.success('Chave copiada.');
    } else {
      this.keyRevealed.set(true);
      this.toast.error('Não foi possível copiar a chave. Ela foi exibida por inteiro para você copiar.');
    }
  }
}
