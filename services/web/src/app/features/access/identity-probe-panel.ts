import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AdminApi, IdentityProbeResult } from '../../core/api';
import { McBanner, McButton, McIcon, McTable, McTextField } from '../../ui';
import { apiErrorMessage } from '../join/api-error';
import { formatAccessReason } from './access-reason';
import { AccessStore } from './access.store';

@Component({
  selector: 'mc-identity-probe-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, McBanner, McButton, McIcon, McTable, McTextField],
  template: `
    <section aria-labelledby="probe-title">
      <div class="mb-4">
        <h2 id="probe-title" class="t-title-md">Testar identidade</h2>
        <p class="t-body-md text-text-muted mt-1">
          Simule a identificação do jogador pelo Tailscale e verifique a permissão em cada mundo sem efeitos colaterais.
        </p>
      </div>

      <div class="bevel-panel bg-surface-default p-4">
        <form class="flex flex-col gap-4" (ngSubmit)="runProbe()">
          <div class="grid gap-4 md:grid-cols-3">
            <mc-text-field
              label="Tailscale User ID"
              autocomplete="off"
              placeholder="Ex: tagged-devices ou ts-user-123"
              [ngModel]="tailscaleUserId()"
              (ngModelChange)="tailscaleUserId.set($event)"
              [ngModelOptions]="{ standalone: true }"
            />
            <mc-text-field
              label="IP Tailscale"
              autocomplete="off"
              placeholder="Ex: 100.64.0.1"
              [ngModel]="ip()"
              (ngModelChange)="ip.set($event)"
              [ngModelOptions]="{ standalone: true }"
            />
            <mc-text-field
              label="Nick no Minecraft"
              autocomplete="off"
              placeholder="Ex: Steve"
              [maxlength]="16"
              [ngModel]="minecraftNick()"
              (ngModelChange)="minecraftNick.set($event)"
              [ngModelOptions]="{ standalone: true }"
            />
          </div>

          <div class="flex items-center gap-3">
            <mc-button
              type="submit"
              variant="primary"
              [disabled]="loading() || (!tailscaleUserId() && !ip() && !minecraftNick())"
            >
              {{ loading() ? 'Testando…' : 'Testar identidade' }}
            </mc-button>
            @if (result() || error()) {
              <mc-button size="sm" variant="neutral" (click)="clear()">
                Limpar
              </mc-button>
            }
          </div>
        </form>

        @if (error()) {
          <div class="mt-4">
            <mc-banner tone="danger" title="Falha ao testar identidade">
              {{ errorText() }}
            </mc-banner>
          </div>
        }

        @if (result(); as res) {
          <div class="mt-6 flex flex-col gap-6" aria-label="Resultado do teste de identidade">
            <!-- Verificação Anti-Impersonação (Nickname) -->
            @if (res.nicknameCheck; as check) {
              <div
                class="rounded border p-4 bg-surface-raised"
                [class.border-status-success]="check.allowed"
                [class.border-status-danger]="!check.allowed"
                role="region"
                aria-label="Verificação de Nickname"
              >
                <div class="flex items-center gap-2">
                  <mc-icon
                    [name]="check.allowed ? 'check' : 'close'"
                    [size]="18"
                    [class.text-status-success]="check.allowed"
                    [class.text-status-danger]="!check.allowed"
                  />
                  <span class="t-label-md font-bold">Anti-Impersonação:</span>
                  <span class="t-body-md">
                    @if (check.allowed) {
                      @if (check.autoAdopted) {
                        Nickname válido (será auto-adotado no primeiro acesso).
                      } @else {
                        Nickname verificado (confere com o jogador registrado).
                      }
                    } @else {
                      @if (check.reason === 'IMPERSONATION_DETECTED') {
                        Tentativa de impersonação detectada: o nickname declarado não confere com o registrado.
                      } @else {
                        Nickname inválido ({{ check.reason }}).
                      }
                    }
                  </span>
                </div>
              </div>
            }

            <!-- WhoIs de Rede -->
            @if (res.whois; as whois) {
              <div class="rounded border border-border-default bg-surface-raised p-4">
                <h3 class="t-title-sm mb-3">Identidade de Rede (WhoIs)</h3>
                <dl class="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <dt class="t-caption text-text-muted">Login Tailscale</dt>
                    <dd class="t-body-strong">{{ whois.loginName || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Dispositivo / Nó</dt>
                    <dd class="t-body-md">{{ whois.nodeName || whois.nodeId || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">IP do Nó</dt>
                    <dd class="t-body-md">{{ whois.nodeIp || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Tags</dt>
                    <dd class="t-body-md">
                      {{ whois.tags?.length ? whois.tags.join(', ') : 'Sem tags' }}
                    </dd>
                  </div>
                </dl>
              </div>
            }

            <!-- Jogador Reconhecido -->
            <div class="rounded border border-border-default bg-surface-raised p-4">
              <h3 class="t-title-sm mb-3">Jogador Reconhecido</h3>
              @if (res.user; as user) {
                <dl class="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <dt class="t-caption text-text-muted">Nickname</dt>
                    <dd class="t-body-strong">
                      <a
                        [routerLink]="['/access/users', user.id]"
                        class="text-action-primary hover:underline"
                      >
                        {{ user.minecraftNick }}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Nome real</dt>
                    <dd class="t-body-md">{{ user.realName || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Critério de Correspondência</dt>
                    <dd class="t-body-md font-semibold">{{ formatMatchedBy(res.matchedBy) }}</dd>
                  </div>
                  <div>
                    <dt class="t-caption text-text-muted">Vínculo de Conta</dt>
                    <dd class="t-body-md">
                      {{ res.wouldBind ? 'Primeiro login vinculará a conta' : 'Já vinculada' }}
                    </dd>
                  </div>
                </dl>
              } @else {
                <p class="t-body-md text-text-muted">
                  Nenhum jogador cadastrado foi associado a estes parâmetros de identidade.
                </p>
              }
            </div>

            <!-- Tabela de Acesso a Mundos -->
            @if (res.user && res.servers.length > 0) {
              <div>
                <h3 class="t-title-sm mb-3">Acesso aos Mundos</h3>
                <div class="overflow-x-auto bg-surface-default">
                  <table mc-table class="min-w-full">
                    <caption class="sr-only">
                      Mundos acessíveis para o jogador sondado
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Mundo</th>
                        <th scope="col">Subdomínio</th>
                        <th scope="col">Acesso</th>
                        <th scope="col">Justificativa</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (server of res.servers; track server.id) {
                        <tr>
                          <td class="font-semibold">{{ server.name }}</td>
                          <td class="t-caption text-text-muted">{{ server.subdomain }}</td>
                          <td>
                            <span
                              class="inline-flex items-center gap-1 font-semibold t-label-sm"
                              [class.text-status-success]="server.allowed"
                              [class.text-status-danger]="!server.allowed"
                            >
                              <mc-icon [name]="server.allowed ? 'check' : 'close'" [size]="14" />
                              <span>{{ server.allowed ? 'Permitido' : 'Negado' }}</span>
                            </span>
                          </td>
                          <td>
                            <span class="t-body-md">{{ formatReason(server) }}</span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class IdentityProbePanel {
  private readonly admin = inject(AdminApi);
  private readonly store = inject(AccessStore, { optional: true });

  readonly tailscaleUserId = signal<string>('');
  readonly ip = signal<string>('');
  readonly minecraftNick = signal<string>('');

  readonly loading = signal<boolean>(false);
  readonly error = signal<unknown | null>(null);
  readonly result = signal<IdentityProbeResult | null>(null);

  constructor() {
    effect(() => {
      const prefill = this.store?.probePrefill();
      if (prefill) {
        this.tailscaleUserId.set(prefill.tailscaleUserId ?? '');
        this.ip.set(prefill.ip ?? '');
        this.minecraftNick.set(prefill.minecraftNick ?? '');
        this.runProbe();
      }
    });
  }

  async runProbe(): Promise<void> {
    const tsUserId = this.tailscaleUserId().trim();
    const clientIp = this.ip().trim();
    const nick = this.minecraftNick().trim();

    if (!tsUserId && !clientIp && !nick) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const res = await firstValueFrom(
        this.admin.probeIdentity({
          tailscaleUserId: tsUserId || undefined,
          ip: clientIp || undefined,
          minecraftNick: nick || undefined,
        }),
      );
      this.result.set(res);
    } catch (err: unknown) {
      this.error.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  clear(): void {
    this.tailscaleUserId.set('');
    this.ip.set('');
    this.minecraftNick.set('');
    this.result.set(null);
    this.error.set(null);
  }

  formatMatchedBy(matchedBy: string): string {
    switch (matchedBy) {
      case 'TAILSCALE_USER_ID':
        return 'Conta Tailscale vinculada diretamente';
      case 'NODE_ID':
        return 'Dispositivo (nó) já registrado para este jogador';
      case 'SHARED_EMAIL':
        return 'E-mail do nó compartilhado coincide com o cadastro';
      case 'SHARED_GITHUB':
        return 'Usuário GitHub do nó compartilhado coincide com o cadastro';
      case 'PENDING_INVITE':
        return 'Único convite pendente disponível (será vinculado no primeiro acesso)';
      default:
        return 'Nenhum jogador correspondente encontrado';
    }
  }

  formatReason(server: { allowed: boolean; reason: string; grantedBy?: any }): string {
    return formatAccessReason(server);
  }

  errorText(): string {
    return apiErrorMessage(this.error(), 'Erro ao executar a sondagem de identidade.');
  }
}
