import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

import { HighlightLanguage } from './file-types';
import { TokenKind, highlight } from './syntax';

const TOKEN_CLASSES: Record<TokenKind, string> = {
  key: 'text-status-info',
  string: 'text-status-success',
  number: 'text-status-accent',
  boolean: 'text-status-warning',
  comment: 'text-text-disabled',
  punct: 'text-text-muted',
  text: 'text-text-primary',
};

/**
 * Textarea editor with line numbers and token colouring. The coloured `<pre>` sits behind a
 * transparent textarea and is moved by the textarea's scroll offsets, so typing, selection and
 * the caret stay native. Both layers must keep the same font metrics (VT323 20/24).
 */
@Component({
  selector: 'mc-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="t-mono-console relative h-full min-h-112 overflow-hidden bg-bg-sunken">
      <div
        class="absolute inset-y-0 left-0 w-14 overflow-hidden border-r-2 border-border-strong text-right text-text-disabled select-none"
        aria-hidden="true"
      >
        <div class="py-3 pr-2" [style.transform]="'translateY(' + -scrollTop() + 'px)'">
          @for (line of tokenLines(); track $index) {
            <div class="h-6">{{ $index + 1 }}</div>
          }
        </div>
      </div>
      <pre
        class="t-mono-console pointer-events-none absolute inset-0 m-0 py-3 pr-4 pl-16 whitespace-pre"
        aria-hidden="true"
        [style.transform]="'translate(' + -scrollLeft() + 'px,' + -scrollTop() + 'px)'"
      >@for (tokens of tokenLines(); track $index) {<div class="h-6">@for (token of tokens; track $index) {<span [class]="classes[token.kind]">{{ token.text }}</span>}</div>}</pre>
      <textarea
        class="t-mono-console absolute inset-0 size-full resize-none overflow-auto bg-transparent py-3 pr-4 pl-16 whitespace-pre text-transparent caret-text-primary outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        wrap="off"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        [attr.aria-label]="label()"
        [readOnly]="readonly()"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
        (scroll)="onScroll($event)"
      ></textarea>
    </div>
  `,
})
export class McCodeEditor {
  readonly value = model('');
  readonly language = input<HighlightLanguage>('plain');
  readonly label = input('Conteúdo do arquivo');
  readonly readonly = input(false);

  protected readonly classes = TOKEN_CLASSES;
  protected readonly scrollTop = signal(0);
  protected readonly scrollLeft = signal(0);
  protected readonly tokenLines = computed(() => highlight(this.value(), this.language()));

  protected onScroll(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.scrollTop.set(target.scrollTop);
    this.scrollLeft.set(target.scrollLeft);
  }
}
