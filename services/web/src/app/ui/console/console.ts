import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { LogEntry, LogLevel } from '../../core/api/models';
import { McButton } from '../button/button';
import { McNoApiTag } from '../no-api-tag/no-api-tag';

export type ConsoleMode = 'logs' | 'rcon';

/** A log line plus its origin, when known. The backend does not separate stdout from RCON yet. */
export interface ConsoleLine extends Pick<LogEntry, 'timestamp' | 'level' | 'message'> {
  id?: string;
  source?: 'stdout' | 'rcon';
}

export const ALL_LEVELS: readonly LogLevel[] = ['INFO', 'WARN', 'ERROR'];
const MAX_HISTORY = 100;

const LEVEL_CLASSES: Record<LogLevel, string> = {
  INFO: 'text-text-primary',
  WARN: 'text-status-warning',
  ERROR: 'text-status-danger',
};

const LEVEL_TOGGLE_ACTIVE: Record<LogLevel, string> = {
  INFO: 'border-status-info text-status-info',
  WARN: 'border-status-warning text-status-warning',
  ERROR: 'border-status-danger text-status-danger',
};

/** Drops Minecraft section-sign colour codes and ANSI escapes so they do not show as noise. */
export function stripFormatting(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/§./g, '');
}

export function formatClock(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleTimeString('pt-BR', { hour12: false });
}

/** Pure filter used by the console view. */
export function filterConsoleLines(
  lines: readonly ConsoleLine[],
  levels: readonly LogLevel[],
  mode: ConsoleMode,
): ConsoleLine[] {
  return lines.filter(
    (line) => levels.includes(line.level) && (mode === 'logs' || line.source === 'rcon'),
  );
}

@Component({
  selector: 'mc-console',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McButton, McNoApiTag],
  host: { class: 'block' },
  template: `
    <div class="bevel-sunken bg-bg-sunken">
      <div
        class="flex flex-wrap items-center gap-3 border-b-2 border-border-strong bg-surface-default p-2"
      >
        <h3 class="t-label-md px-2">Console</h3>
        <div class="flex" role="group" aria-label="Origem da saída">
          @for (option of modeOptions; track option.id) {
            <button
              type="button"
              class="t-button-sm h-10 border-2 border-border-strong px-3"
              [class]="
                mode() === option.id
                  ? 'bg-action-light text-text-inverse'
                  : 'bg-bg-sunken text-text-muted'
              "
              [attr.aria-pressed]="mode() === option.id"
              (click)="mode.set(option.id)"
            >
              {{ option.label }}
            </button>
          }
        </div>
        @if (splitMissing()) {
          <mc-no-api-tag detail="stdout × RCON" />
        }
        <div class="ml-auto flex gap-1" role="group" aria-label="Filtrar por nível">
          @for (level of levels; track level) {
            <button
              type="button"
              class="t-button-sm h-10 border-2 px-3"
              [class]="
                filters().includes(level)
                  ? levelToggleActive[level]
                  : 'border-border-strong text-text-disabled'
              "
              [attr.aria-pressed]="filters().includes(level)"
              (click)="toggleLevel(level)"
            >
              {{ level }}
            </button>
          }
        </div>
      </div>

      <div
        #viewport
        class="t-mono-console h-96 overflow-y-auto p-3 break-words whitespace-pre-wrap"
        role="log"
        aria-live="off"
        tabindex="0"
        aria-label="Saída do console"
        (scroll)="onScroll()"
      >
        @for (line of visibleLines(); track $index) {
          <div [class]="levelClasses[line.level]">
            <span class="text-text-muted">[{{ clock(line.timestamp) }}]</span>
            {{ clean(line.message) }}
          </div>
        } @empty {
          <p class="text-text-muted">Nenhuma linha para exibir.</p>
        }
      </div>

      <form
        class="flex items-center gap-2 border-t-2 border-border-strong p-2"
        (submit)="submit($event)"
      >
        <span class="t-mono-console pl-2 text-status-success" aria-hidden="true">&gt;</span>
        <input
          class="t-mono-console h-10 min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-disabled disabled:text-text-disabled"
          type="text"
          autocomplete="off"
          spellcheck="false"
          aria-label="Comando"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [value]="draft()"
          (input)="draft.set(asInput($event).value)"
          (keydown)="onKeydown($event)"
        />
        <mc-button
          type="submit"
          variant="primary"
          size="sm"
          [disabled]="disabled() || draft().trim() === ''"
          >Enviar</mc-button
        >
      </form>
    </div>
  `,
})
export class McConsole {
  readonly lines = input.required<readonly ConsoleLine[]>();
  readonly filters = model<LogLevel[]>([...ALL_LEVELS]);
  readonly mode = model<ConsoleMode>('logs');
  readonly disabled = input(false);
  readonly placeholder = input('Digite um comando (/? para ajuda)');
  /** Shows the "no API" tag next to the Logs/RCON switch while the backend cannot split them. */
  readonly splitMissing = input(true);
  readonly command = output<string>();

  protected readonly levels = ALL_LEVELS;
  protected readonly levelClasses = LEVEL_CLASSES;
  protected readonly levelToggleActive = LEVEL_TOGGLE_ACTIVE;
  protected readonly modeOptions: { id: ConsoleMode; label: string }[] = [
    { id: 'logs', label: 'Logs' },
    { id: 'rcon', label: 'RCON' },
  ];
  protected readonly clock = formatClock;
  protected readonly clean = stripFormatting;

  protected readonly draft = signal('');
  protected readonly visibleLines = computed(() =>
    filterConsoleLines(this.lines(), this.filters(), this.mode()),
  );

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly history: string[] = [];
  private historyCursor = -1;
  private stickToBottom = true;

  constructor() {
    afterRenderEffect(() => {
      this.visibleLines();
      const el = this.viewport().nativeElement;
      if (this.stickToBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  protected asInput(event: Event): HTMLInputElement {
    return event.target as HTMLInputElement;
  }

  protected toggleLevel(level: LogLevel): void {
    this.filters.update((current) =>
      current.includes(level) ? current.filter((l) => l !== level) : [...current, level],
    );
  }

  protected onScroll(): void {
    const el = this.viewport().nativeElement;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text || this.disabled()) {
      return;
    }
    this.history.push(text);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.historyCursor = -1;
    this.draft.set('');
    this.stickToBottom = true;
    this.command.emit(text);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      this.historyCursor = Math.min(this.historyCursor + 1, this.history.length - 1);
    } else {
      this.historyCursor = Math.max(this.historyCursor - 1, -1);
    }
    this.draft.set(
      this.historyCursor === -1 ? '' : this.history[this.history.length - 1 - this.historyCursor],
    );
  }
}
