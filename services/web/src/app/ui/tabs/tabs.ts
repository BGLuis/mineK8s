import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface McTabItem {
  id: string;
  label: string;
  /** When set the tab is a router link and `active` is ignored. */
  link?: string | unknown[];
}

@Component({
  selector: 'mc-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-wrap gap-1 border-b-4 border-surface-default"
      role="tablist"
      [attr.aria-label]="label()"
    >
      @for (tab of tabs(); track tab.id) {
        @if (tab.link) {
          <a
            class="t-label-md inline-flex h-12 items-center border-t-4 border-transparent bg-bg-sunken px-4 text-text-muted hover:text-text-primary"
            routerLinkActive="border-action-primary! bg-surface-default! text-text-primary!"
            ariaCurrentWhenActive="page"
            [routerLink]="tab.link"
            [routerLinkActiveOptions]="{ exact: true }"
          >
            {{ tab.label }}
          </a>
        } @else {
          <button
            type="button"
            role="tab"
            class="t-label-md inline-flex h-12 items-center border-t-4 px-4"
            [class]="
              tab.id === active()
                ? 'border-action-primary bg-surface-default text-text-primary'
                : 'border-transparent bg-bg-sunken text-text-muted hover:text-text-primary'
            "
            [attr.aria-selected]="tab.id === active()"
            [attr.tabindex]="tab.id === active() ? 0 : -1"
            (click)="active.set(tab.id)"
            (keydown)="onKeydown($event, $index)"
          >
            {{ tab.label }}
          </button>
        }
      }
    </div>
  `,
})
export class McTabs {
  readonly tabs = input.required<McTabItem[]>();
  readonly active = model<string>();
  readonly label = input('Seções');

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset === 0) {
      return;
    }
    event.preventDefault();
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    this.active.set(next.id);
    const siblings = (event.currentTarget as HTMLElement).parentElement?.children;
    (siblings?.[tabs.indexOf(next)] as HTMLElement | undefined)?.focus();
  }
}
