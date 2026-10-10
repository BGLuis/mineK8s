import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServersApi } from '../../../core/api/servers.api';
import { McButton, McPanel, ToastService } from '../../../ui';
import { errorReason } from '../../dashboard/server-lifecycle';
import { SERVER_ICON_ENCODER, SERVER_ICON_SIZE } from './server-icon';

/** The image Minecraft shows next to the server in the multiplayer list. */
@Component({
  selector: 'mc-server-icon-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McButton, McPanel],
  template: `
    <mc-panel title="Ícone na lista de servidores">
      <div class="flex flex-wrap items-start gap-6">
        <div
          class="size-24 shrink-0 border-2 border-border-strong bg-surface-input"
          [attr.aria-busy]="busy()"
        >
          @if (shown(); as source) {
            <img
              class="size-full [image-rendering:pixelated]"
              alt="Ícone do servidor"
              [src]="source"
            />
          } @else {
            <p class="t-caption flex size-full items-center justify-center text-center text-text-muted">
              Sem ícone
            </p>
          }
        </div>

        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <p class="t-body-md text-text-muted">
            Qualquer imagem serve: ela é recortada no centro e reduzida para
            {{ size }}×{{ size }} px, o tamanho que o Minecraft mostra. Com o mundo hibernando o
            ícone já aparece na lista; com ele ligado, o Minecraft só troca a imagem na próxima
            partida.
          </p>

          <!-- The native control is nearly invisible on the dark theme; the button below opens it. -->
          <input
            #picker
            type="file"
            accept="image/*"
            class="sr-only"
            aria-label="Escolher a imagem do ícone"
            [disabled]="busy()"
            (change)="choose($event)"
          />
          <div class="flex flex-wrap items-center gap-3">
            <mc-button variant="light" [disabled]="busy()" (click)="picker.click()">
              Escolher imagem
            </mc-button>
            <span class="t-body-md min-w-0 truncate text-text-muted">
              {{ pendingName() ?? 'Nenhuma imagem escolhida' }}
            </span>
          </div>

          <div class="flex flex-wrap gap-3">
            <mc-button variant="primary" [disabled]="!pending() || busy()" (click)="upload()">
              {{ busy() ? 'Enviando…' : 'Enviar ícone' }}
            </mc-button>
            <mc-button variant="light" [disabled]="!current() || busy()" (click)="remove()">
              Remover ícone
            </mc-button>
          </div>
        </div>
      </div>
    </mc-panel>
  `,
})
export class ServerIconPanel {
  readonly serverId = input.required<string>();

  private readonly api = inject(ServersApi);
  private readonly toast = inject(ToastService);
  private readonly encode = inject(SERVER_ICON_ENCODER);

  protected readonly size = SERVER_ICON_SIZE;
  protected readonly busy = signal(false);
  /** Object URL of the icon the server has now. */
  protected readonly current = signal<string | null>(null);
  /** The converted image the admin picked and has not sent yet. */
  protected readonly pending = signal<{ blob: Blob; url: string; name: string } | null>(null);
  protected readonly pendingName = () => this.pending()?.name ?? null;
  protected readonly shown = () => this.pending()?.url ?? this.current();

  private readonly urls = new Set<string>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const url of this.urls) {
        URL.revokeObjectURL(url);
      }
    });

    effect(() => {
      const id = this.serverId();
      untracked(() => void this.load(id));
    });
  }

  protected async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    try {
      const blob = await this.encode(file);
      this.setPending({ blob, url: this.track(blob), name: file.name });
    } catch (error) {
      this.toast.error(`Não foi possível ler essa imagem. ${errorReason(error)}`);
    }
  }

  protected async upload(): Promise<void> {
    const pending = this.pending();
    if (!pending) {
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.setIcon(this.serverId(), pending.blob));
    } catch (error) {
      this.toast.error(`Não foi possível enviar o ícone. ${errorReason(error)}`);
      return;
    } finally {
      this.busy.set(false);
    }
    // The object URL of the sent image now belongs to `current`.
    this.setCurrent(pending.url);
    this.pending.set(null);
    this.toast.success('Ícone salvo.');
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.removeIcon(this.serverId()));
    } catch (error) {
      this.toast.error(`Não foi possível remover o ícone. ${errorReason(error)}`);
      return;
    } finally {
      this.busy.set(false);
    }
    this.setCurrent(null);
    this.setPending(null);
    this.toast.success('Ícone removido.');
  }

  private async load(id: string): Promise<void> {
    try {
      const blob = await firstValueFrom(this.api.icon(id));
      this.setCurrent(this.track(blob));
    } catch {
      // 404 is the normal answer for a server that never had an icon.
      this.setCurrent(null);
    }
  }

  private track(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  private release(url: string | undefined): void {
    if (url && this.urls.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }

  private setCurrent(url: string | null): void {
    const previous = this.current();
    this.current.set(url);
    if (previous && previous !== url) {
      this.release(previous);
    }
  }

  private setPending(next: { blob: Blob; url: string; name: string } | null): void {
    const previous = this.pending();
    this.pending.set(next);
    if (previous && previous.url !== next?.url) {
      this.release(previous.url);
    }
  }
}
