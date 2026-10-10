import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export const PLAYER_HEAD_ORIGIN = 'https://mc-heads.net';

/** Twice the rendered size (40px), so the head stays sharp on high-density screens. */
const PLAYER_HEAD_PIXELS = 80;

export function playerHeadUrl(nick: string): string {
  return `${PLAYER_HEAD_ORIGIN}/avatar/${encodeURIComponent(nick)}/${PLAYER_HEAD_PIXELS}`;
}

/**
 * The player's head from mc-heads.net, looked up by nick. When the image cannot load (offline panel,
 * service down) it falls back to the nick's initial; the caller colours that fallback through `class`.
 */
@Component({
  selector: 'mc-player-head',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 't-label-md inline-flex size-10 shrink-0 items-center justify-center overflow-hidden',
    'aria-hidden': 'true',
  },
  template: `
    @if (headUrl(); as url) {
      <img
        class="size-full [image-rendering:pixelated]"
        alt=""
        [src]="url"
        (error)="failedNick.set(nick())"
      />
    } @else {
      {{ initial() }}
    }
  `,
})
export class McPlayerHead {
  readonly nick = input.required<string>();

  protected readonly failedNick = signal<string | null>(null);
  protected readonly headUrl = computed(() =>
    this.failedNick() === this.nick() ? null : playerHeadUrl(this.nick()),
  );
  protected readonly initial = computed(() => this.nick().charAt(0).toUpperCase());
}
