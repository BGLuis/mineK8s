import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { LogLevel } from '../../../core/api/models';
import {
  CommandOutput,
  MAX_COMMANDS_PER_SECOND,
  TerminalSocket,
  TerminalStatus,
} from '../../../core/realtime';
import { McBanner, McButton, McConsole, ToastService, statusChipConfig } from '../../../ui';
import { ServerDetailStore } from '../server-detail.store';
import { LocalLine, QUICK_COMMANDS, mergeConsoleLines, normalizeCommand } from './console.logic';

const CONNECTION: Record<TerminalStatus, { label: string; dot: string }> = {
  idle: { label: 'Aguardando', dot: 'bg-status-neutral' },
  connecting: { label: 'Conectando…', dot: 'bg-status-warning' },
  connected: { label: 'Conectado', dot: 'bg-status-success' },
  disconnected: { label: 'Desconectado', dot: 'bg-status-danger' },
  unauthorized: { label: 'Sem permissão', dot: 'bg-status-danger' },
};

@Component({
  selector: 'mc-server-console-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McBanner, McButton, McConsole],
  template: `
    <div class="mb-3 flex flex-wrap items-center justify-end gap-3">
      <p class="t-caption flex items-center gap-2 text-text-muted" role="status">
        <span class="size-2" [class]="connection().dot" aria-hidden="true"></span>
        {{ connection().label }}
      </p>
    </div>

    <div class="mb-4 flex flex-col gap-3">
      @if (terminal.status() === 'unauthorized') {
        <mc-banner tone="danger" title="Sem permissão para o console">
          {{ terminal.errorMessage() ?? 'Sua sessão não pode abrir o console deste servidor.' }}
        </mc-banner>
      } @else if (terminal.status() === 'disconnected') {
        <mc-banner tone="warning" title="Conexão perdida">
          O console reconecta sozinho. O histórico recente volta quando a conexão voltar.
        </mc-banner>
      }
      @if (notRunning(); as label) {
        <mc-banner tone="info" title="Servidor fora do ar">
          O servidor está {{ label }}. Ligue-o para enviar comandos; os logs continuam visíveis.
        </mc-banner>
      }
    </div>

    <div class="has-drop">
      <mc-console
        #consoleRef
        [lines]="lines()"
        [(filters)]="filters"
        [splitMissing]="false"
        [disabled]="inputDisabled()"
        [placeholder]="limited() ? 'Aguarde um instante…' : 'Digite um comando (↑/↓ histórico)'"
        (command)="send($event)"
      />
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <span class="t-label-md text-text-muted">Atalhos:</span>
      @for (command of quickCommands; track command) {
        <mc-button size="sm" [disabled]="inputDisabled()" (click)="send(command)">
          {{ command }}
        </mc-button>
      }
    </div>

    <p class="t-caption mt-6 text-text-muted">
      Comandos via Socket.IO /terminal (send_command). Histórico: ↑/↓. Até {{ maxPerSecond }}
      comandos por segundo; o botão Enviar desabilita ao atingir o limite.
    </p>
  `,
})
export class ServerConsolePage {
  protected readonly terminal = inject(TerminalSocket);
  private readonly store = inject(ServerDetailStore);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly quickCommands = QUICK_COMMANDS;
  protected readonly maxPerSecond = MAX_COMMANDS_PER_SECOND;
  protected readonly filters = signal<LogLevel[]>(['INFO', 'WARN', 'ERROR']);
  protected readonly limited = signal(false);

  private readonly local = signal<LocalLine[]>([]);
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly lines = computed(() => mergeConsoleLines(this.terminal.lines(), this.local()));
  protected readonly connection = computed(() => CONNECTION[this.terminal.status()]);
  /** Label of the server state when it is known and not READY. */
  protected readonly notRunning = computed(() => {
    const server = this.store.server();
    return server && server.state !== 'READY'
      ? statusChipConfig(server.state).label.toLowerCase()
      : null;
  });
  protected readonly inputDisabled = computed(
    () => this.limited() || this.terminal.status() !== 'connected' || this.notRunning() !== null,
  );

  constructor() {
    effect(() => {
      const id = this.store.serverId();
      if (id) {
        untracked(() => {
          this.local.set([]);
          this.terminal.join(id);
        });
      }
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.releaseTimer);
      this.terminal.leave();
    });

    this.terminal.commandOutput
      .pipe(takeUntilDestroyed())
      .subscribe((output) => this.appendOutput(output));

    effect(() => {
      const message = this.terminal.errorMessage();
      if (
        message &&
        !untracked(() => this.limited()) &&
        this.terminal.status() !== 'unauthorized'
      ) {
        this.toast.error(message);
      }
    });
  }

  protected send(raw: string): void {
    const command = normalizeCommand(raw);
    if (command === '' || this.inputDisabled()) {
      return;
    }
    const now = Date.now();
    const accepted = this.terminal.sendCommand(command);
    if (!accepted) {
      this.limit(now);
      return;
    }
    this.pushLocal({ level: 'INFO', message: `> ${command}` });
    if (this.terminal.limiter.isFull(now)) {
      this.limit(now);
    }
  }

  private limit(now: number): void {
    // A disabled input drops focus; give it back afterwards if the user was typing there.
    const wasTyping = this.host.nativeElement
      .querySelector('form')
      ?.contains(document.activeElement);
    this.limited.set(true);
    this.toast.warning(
      `Limite de ${MAX_COMMANDS_PER_SECOND} comandos por segundo atingido. Aguarde um instante.`,
    );
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(
      () => {
        this.limited.set(false);
        if (wasTyping) {
          afterNextRender(() => this.host.nativeElement.querySelector('input')?.focus(), {
            injector: this.injector,
          });
        }
      },
      Math.max(this.terminal.limiter.msUntilFree(now), 100),
    );
  }

  private appendOutput(output: CommandOutput): void {
    for (const message of output.output.split('\n').filter((line) => line.trim() !== '')) {
      this.pushLocal({ level: output.error ? 'ERROR' : 'INFO', message });
    }
  }

  private pushLocal(line: Pick<LocalLine, 'level' | 'message'>): void {
    const log = this.terminal.lines();
    this.local.update((lines) => [
      ...lines,
      {
        ...line,
        timestamp: new Date().toISOString(),
        source: 'rcon',
        afterId: log.length > 0 ? log[log.length - 1].id : null,
      },
    ]);
  }
}
