import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthSession } from '../../core/auth';
import { McBanner, McButton, McLegalFooter, McPanel, McTextField, McVoxelScene } from '../../ui';
import { focusFirstInvalid } from '../access/format';
import { apiErrorMessage, asHttpError } from '../join/api-error';
import { NICK_HELP, validateNick } from '../join/nick';
import { LoginGround } from './login-ground';
import { safeRedirect } from './login.logic';

@Component({
  selector: 'mc-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    McBanner,
    McButton,
    McLegalFooter,
    McPanel,
    McTextField,
    McVoxelScene,
    LoginGround,
  ],
  template: `
    <div class="relative isolate flex min-h-dvh flex-col overflow-hidden bg-scene-sky">
      <mc-voxel-scene class="absolute inset-0 -z-20 h-full w-full aspect-auto!" [variant]="1" />
      <mc-login-ground class="absolute inset-x-0 bottom-0 -z-10 h-[34dvh] min-h-48" />

      <main class="flex flex-1 items-center justify-center p-4 py-8">
        <div class="w-full max-w-md">
          <mc-panel>
            <div class="flex flex-col gap-4">
              <div class="flex items-center justify-center gap-3">
                <span
                  class="size-12 bg-scene-grass shadow-[inset_0_-18px_0_var(--color-scene-dirt)]"
                  aria-hidden="true"
                ></span>
                <h1 class="t-display-lg">mineK8s</h1>
              </div>
              <p class="t-body-md text-center text-text-muted">
                Painel dos seus servidores de Minecraft
              </p>

              <section
                class="flex flex-col gap-3 border-2 border-status-success bg-bg-sunken p-3"
                aria-labelledby="vpn-title"
              >
                <p id="vpn-title" class="t-caption text-status-success">
                  @if (identity(); as nick) {
                    Você está na rede Tailscale como {{ nick }}
                  } @else {
                    Acesso pela VPN: o Tailscale identifica você
                  }
                </p>
                <mc-button
                  variant="primary"
                  icon="play"
                  [block]="true"
                  [disabled]="busy()"
                  (click)="signInWithVpn()"
                >
                  {{ vpnBusy() ? 'Verificando…' : 'Entrar como admin' }}
                </mc-button>
                @if (vpnError()) {
                  <mc-banner tone="danger" title="Não foi possível entrar pela VPN">
                    {{ vpnError() }}
                  </mc-banner>
                }
              </section>

              <div class="flex items-center gap-3" aria-hidden="true">
                <span class="h-0.5 flex-1 bg-border-default"></span>
                <span class="t-caption text-text-muted">primeiro acesso</span>
                <span class="h-0.5 flex-1 bg-border-default"></span>
              </div>

              <form
                #bootstrapForm
                class="flex flex-col gap-4"
                novalidate
                (ngSubmit)="bootstrap(bootstrapForm)"
              >
                <mc-text-field
                  label="Token de instalação"
                  placeholder="Cole o token mostrado nos logs"
                  autocomplete="off"
                  helpText="Aparece uma única vez nos logs do control plane."
                  [errorText]="visibleTokenError()"
                  [ngModel]="token()"
                  (ngModelChange)="token.set($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                <mc-text-field
                  label="Seu nick do Minecraft"
                  autocomplete="username"
                  [maxlength]="16"
                  [helpText]="nickHelp"
                  [errorText]="visibleNickError()"
                  [ngModel]="nick()"
                  (ngModelChange)="nick.set($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                @if (bootstrapError()) {
                  <mc-banner tone="danger" title="Não foi possível criar o administrador">
                    {{ bootstrapError() }}
                  </mc-banner>
                }
                <mc-button type="submit" variant="light" [block]="true" [disabled]="busy()">
                  {{ bootstrapBusy() ? 'Criando…' : 'Criar primeiro administrador' }}
                </mc-button>
              </form>
            </div>
          </mc-panel>
        </div>
      </main>

      <mc-legal-footer class="relative" />
    </div>
  `,
})
export class LoginPage implements OnInit {
  private readonly session = inject(AuthSession);
  private readonly router = inject(Router);
  /** Read once: a 401 from the session request makes the interceptor navigate to a bare /login. */
  private readonly target = safeRedirect(
    inject(ActivatedRoute).snapshot.queryParamMap.get('redirect'),
  );

  protected readonly nickHelp = NICK_HELP;
  protected readonly token = signal('');
  protected readonly nick = signal('');
  protected readonly identity = signal('');
  protected readonly vpnBusy = signal(false);
  protected readonly bootstrapBusy = signal(false);
  protected readonly busy = computed(() => this.vpnBusy() || this.bootstrapBusy());
  protected readonly vpnError = signal('');
  protected readonly bootstrapError = signal('');
  private readonly submitted = signal(false);

  private readonly tokenError = computed(() =>
    this.token().trim() ? '' : 'Cole o token de instalação.',
  );
  private readonly nickError = computed(() => validateNick(this.nick()) ?? '');
  protected readonly visibleTokenError = computed(() =>
    this.submitted() ? this.tokenError() : '',
  );
  protected readonly visibleNickError = computed(() => (this.submitted() ? this.nickError() : ''));

  ngOnInit(): void {
    this.session.restore().subscribe((user) => {
      if (user && user.role !== 'ADMIN') {
        void this.router.navigateByUrl('/meus-mundos');
      }
    });
  }

  protected signInWithVpn(): void {
    this.vpnError.set('');
    this.vpnBusy.set(true);
    this.session.login().subscribe({
      next: (user) => {
        this.identity.set(user.minecraft_nick);
        if (user.role !== 'ADMIN') {
          void this.router.navigateByUrl('/meus-mundos');
          return;
        }
        void this.router.navigateByUrl(this.target);
      },
      error: (error: unknown) => this.failVpn(error),
    });
  }

  protected bootstrap(form: HTMLElement): void {
    this.submitted.set(true);
    this.bootstrapError.set('');
    if (this.tokenError() || this.nickError()) {
      focusFirstInvalid(form);
      return;
    }
    this.bootstrapBusy.set(true);
    this.session
      .bootstrap({ bootstrap_token: this.token().trim(), minecraft_nick: this.nick().trim() })
      .subscribe({
        next: () => void this.router.navigateByUrl(this.target),
        error: (error: unknown) => {
          this.bootstrapBusy.set(false);
          this.bootstrapError.set(
            apiErrorMessage(error, 'Confira o token e o nick e tente de novo.'),
          );
        },
      });
  }

  private failVpn(error: unknown): void {
    this.vpnBusy.set(false);
    this.identity.set('');
    const status = asHttpError(error)?.status;
    this.vpnError.set(
      status === 401 || status === 403 || status === undefined
        ? 'Não identificamos você pela VPN. Conecte o Tailscale neste aparelho ou use o primeiro acesso abaixo.'
        : status === 503
          ? 'O servidor não conseguiu consultar o Tailscale. Tente de novo em instantes.'
          : apiErrorMessage(error, 'Tente de novo em instantes.'),
    );
  }
}
