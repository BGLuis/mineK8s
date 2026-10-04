import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { FileItem, ServerState } from '../../../core/api/models';
import { FilesApi } from '../../../core/api/files.api';
import { ServersApi } from '../../../core/api/servers.api';
import { DialogService, McBanner, McButton, McIcon, McNoApiTag, ToastService } from '../../../ui';
import { McCodeEditor } from './code-editor';
import { checkEditable, formatBytes, languageFor, looksBinary } from './file-types';
import {
  breadcrumbs,
  fileErrorMessage,
  isWorldArchive,
  parentPath,
  sortEntries,
} from './files.model';

const RUNNING_STATES: readonly ServerState[] = ['READY', 'STARTING'];

@Component({
  selector: 'mc-server-files-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McBanner, McButton, McCodeEditor, McIcon, McNoApiTag],
  host: { '(window:beforeunload)': 'warnBeforeUnload($event)' },
  template: `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
      <nav aria-label="Caminho atual">
        <ol class="t-label-md flex flex-wrap items-center">
          @for (crumb of crumbs(); track crumb.path; let last = $last) {
            <li class="flex items-center">
              <button
                type="button"
                class="inline-flex min-h-10 items-center px-1 hover:text-status-warning"
                [class.text-text-muted]="!last"
                [attr.aria-current]="last ? 'page' : null"
                (click)="navigate(crumb.path)"
              >
                {{ crumb.label }}
              </button>
              @if (!last) {
                <span class="px-1 text-text-muted" aria-hidden="true">/</span>
              }
            </li>
          }
        </ol>
      </nav>

      <div class="flex flex-wrap items-center gap-3">
        <mc-no-api-tag detail="upload avulso, nova pasta, renomear" />
        <mc-button variant="info" icon="upload" [disabled]="uploading()" (click)="pickArchive()">
          {{ uploading() ? 'Enviando…' : 'Enviar mundo (.zip / .tar.gz)' }}
        </mc-button>
        <input
          #archive
          type="file"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          accept=".zip,.tar,.tar.gz,.tgz"
          (change)="onArchiveChosen($event)"
        />
      </div>
    </div>

    @if (running()) {
      <mc-banner class="mb-4" tone="warning" title="Servidor ligado">
        Para enviar um mundo ou alterar arquivos do mundo, pare o servidor antes.
      </mc-banner>
    }
    @if (uploadError()) {
      <mc-banner
        class="mb-4"
        tone="danger"
        title="Envio recusado"
        [dismissible]="true"
        (dismissed)="uploadError.set('')"
      >
        {{ uploadError() }}
      </mc-banner>
    }

    <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section
        class="bevel-panel has-drop box-border bg-surface-default p-2"
        aria-label="Arquivos de {{ currentPath() || '/data' }}"
        [attr.aria-busy]="listLoading()"
      >
        @if (listError()) {
          <div class="p-2">
            <mc-banner tone="danger" title="Não foi possível listar">
              {{ listError() }}
            </mc-banner>
            <div class="mt-3">
              <mc-button size="sm" variant="neutral" (click)="reload()">Tentar de novo</mc-button>
            </div>
          </div>
        } @else if (listLoading()) {
          <p class="t-body-md p-4 text-text-muted" role="status">Carregando arquivos…</p>
        } @else {
          <ul class="t-body-lg">
            @if (currentPath()) {
              <li>
                <button type="button" class="entry text-text-muted" (click)="navigate(parent())">
                  <mc-icon name="chevron-left" [size]="16" />
                  <span>Voltar</span>
                </button>
              </li>
            }
            @for (entry of entries(); track entry.path) {
              <li>
                <button
                  type="button"
                  class="entry"
                  [class.is-selected]="selected()?.path === entry.path"
                  [attr.aria-current]="selected()?.path === entry.path ? 'true' : null"
                  (click)="openEntry(entry)"
                >
                  <mc-icon
                    [name]="entry.isDirectory ? 'folder' : 'file'"
                    [size]="16"
                    [class]="entry.isDirectory ? 'text-status-warning' : 'text-text-muted'"
                  />
                  <span
                    class="min-w-0 flex-1 truncate"
                    [class.text-text-muted]="!entry.isDirectory && !isTextCandidate(entry)"
                  >
                    {{ entry.name }}{{ entry.isDirectory ? '/' : '' }}
                  </span>
                  @if (!entry.isDirectory) {
                    <span class="t-caption text-text-muted">{{ size(entry) }}</span>
                  }
                </button>
              </li>
            } @empty {
              <li class="p-4 text-text-muted">Esta pasta está vazia.</li>
            }
          </ul>
        }
      </section>

      <section
        class="bevel-panel has-drop box-border flex min-w-0 flex-col bg-surface-default"
        aria-label="Editor de arquivo"
        (keydown.control.s)="$event.preventDefault(); save()"
      >
        @if (selected(); as file) {
          <header class="flex flex-wrap items-center justify-between gap-3 p-3">
            <h2 class="t-label-md min-w-0 flex-1 truncate" [title]="file.path">{{ file.name }}</h2>
            <div class="flex items-center gap-3">
              @if (dirty()) {
                <span class="t-caption text-status-warning" role="status">Não salvo</span>
              }
              <mc-button size="sm" variant="danger" [disabled]="busy()" (click)="deleteSelected()">
                Excluir
              </mc-button>
              <mc-button
                size="sm"
                variant="primary"
                [disabled]="!editable() || !dirty() || busy()"
                (click)="save()"
              >
                {{ saving() ? 'Salvando…' : 'Salvar' }}
              </mc-button>
            </div>
          </header>

          @if (fileLoading()) {
            <p class="t-body-md p-4 text-text-muted" role="status">Abrindo arquivo…</p>
          } @else if (notice()) {
            <div class="p-3 pt-0">
              <mc-banner tone="warning" title="Não dá para editar este arquivo">
                {{ notice() }}
              </mc-banner>
            </div>
          } @else {
            @if (fileError()) {
              <div class="p-3 pt-0">
                <mc-banner
                  tone="danger"
                  title="Falha ao salvar"
                  [dismissible]="true"
                  (dismissed)="fileError.set('')"
                >
                  {{ fileError() }}
                </mc-banner>
              </div>
            }
            <mc-code-editor
              class="min-h-0 flex-1"
              [(value)]="content"
              [language]="language()"
              [label]="'Conteúdo de ' + file.name"
            />
          }
        } @else {
          <div
            class="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <mc-icon class="text-text-muted" name="file" [size]="32" />
            <p class="t-body-lg text-text-muted">Selecione um arquivo de texto para editar.</p>
          </div>
        }
      </section>
    </div>

    <p class="t-caption mt-6 text-text-muted">
      Editor leve com destaque de sintaxe para .properties, .yml, .json e .toml. Caminhos fora de
      /data e links simbólicos são recusados pela API.
    </p>
  `,
  styles: `
    .entry {
      display: flex;
      width: 100%;
      min-height: 40px;
      align-items: center;
      gap: 12px;
      padding: 0 12px;
      text-align: left;
      border-left: 4px solid transparent;
    }
    .entry:hover {
      background-color: var(--color-surface-hover);
    }
    .entry.is-selected {
      background-color: var(--color-surface-hover);
      border-left-color: var(--color-border-focus);
    }
  `,
})
export class ServerFilesPage {
  private readonly files = inject(FilesApi);
  private readonly servers = inject(ServersApi);
  private readonly dialogs = inject(DialogService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();

  private readonly archive = viewChild<ElementRef<HTMLInputElement>>('archive');

  protected readonly currentPath = signal('');
  protected readonly listing = signal<FileItem[]>([]);
  protected readonly listLoading = signal(true);
  protected readonly listError = signal('');

  protected readonly selected = signal<FileItem | null>(null);
  protected readonly content = signal('');
  private readonly original = signal('');
  protected readonly fileLoading = signal(false);
  protected readonly fileError = signal('');
  protected readonly notice = signal('');
  protected readonly saving = signal(false);

  protected readonly uploading = signal(false);
  protected readonly uploadError = signal('');
  private readonly serverState = signal<ServerState | null>(null);

  protected readonly crumbs = computed(() => breadcrumbs(this.currentPath()));
  protected readonly parent = computed(() => parentPath(this.currentPath()));
  protected readonly entries = computed(() => sortEntries(this.listing()));
  protected readonly editable = computed(() => this.selected() !== null && !this.notice());
  protected readonly dirty = computed(() => this.editable() && this.content() !== this.original());
  protected readonly language = computed(() => languageFor(this.selected()?.name ?? ''));
  protected readonly running = computed(() => {
    const state = this.serverState();
    return state !== null && RUNNING_STATES.includes(state);
  });
  protected readonly busy = computed(() => this.saving() || this.fileLoading());

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.servers.get(id).subscribe({
          next: (server) => this.serverState.set(server.state),
          error: () => this.serverState.set(null),
        });
        this.currentPath.set('');
        this.closeFile();
        this.load('');
      });
    });
  }

  protected size(entry: FileItem): string {
    return formatBytes(entry.size);
  }

  protected isTextCandidate(entry: FileItem): boolean {
    return checkEditable(entry).editable;
  }

  protected reload(): void {
    this.load(this.currentPath());
  }

  protected async navigate(path: string): Promise<void> {
    if (path === this.currentPath() || !(await this.confirmDiscard())) {
      return;
    }
    this.closeFile();
    this.load(path);
  }

  protected async openEntry(entry: FileItem): Promise<void> {
    if (entry.isDirectory) {
      await this.navigate(entry.path);
      return;
    }
    if (this.selected()?.path === entry.path || !(await this.confirmDiscard())) {
      return;
    }
    this.closeFile();
    this.selected.set(entry);

    const check = checkEditable(entry);
    if (!check.editable) {
      this.notice.set(check.reason);
      return;
    }
    this.fileLoading.set(true);
    this.files.read(this.id(), entry.path).subscribe({
      next: ({ content }) => {
        if (this.selected()?.path !== entry.path) {
          return;
        }
        this.fileLoading.set(false);
        if (looksBinary(content)) {
          this.notice.set(
            'Arquivo binário: não dá para editar como texto. Use o envio de mundo para substituí-lo.',
          );
          return;
        }
        this.original.set(content);
        this.content.set(content);
      },
      error: (error) => {
        this.fileLoading.set(false);
        this.notice.set(fileErrorMessage('read', error));
      },
    });
  }

  protected save(): void {
    const file = this.selected();
    if (!file || !this.dirty() || this.busy()) {
      return;
    }
    const content = this.content();
    this.saving.set(true);
    this.fileError.set('');
    this.files.write(this.id(), file.path, content).subscribe({
      next: () => {
        this.saving.set(false);
        this.original.set(content);
        this.toast.success(`${file.name} salvo.`);
      },
      error: (error) => {
        this.saving.set(false);
        this.fileError.set(fileErrorMessage('write', error));
      },
    });
  }

  protected async deleteSelected(): Promise<void> {
    const file = this.selected();
    if (!file) {
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: `Excluir ${file.name}?`,
      message: 'O arquivo é removido do armazenamento do servidor e não dá para desfazer.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) {
      return;
    }
    this.files.delete(this.id(), file.path).subscribe({
      next: () => {
        this.toast.success(`${file.name} excluído.`);
        this.closeFile();
        this.reload();
      },
      error: (error) => this.toast.error(fileErrorMessage('delete', error)),
    });
  }

  protected pickArchive(): void {
    this.archive()?.nativeElement.click();
  }

  protected async onArchiveChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.uploadError.set('');
    if (!isWorldArchive(file.name)) {
      this.uploadError.set('Formato não suportado. Envie um .zip, .tar, .tar.gz ou .tgz.');
      return;
    }
    const confirmed = await this.dialogs.confirm({
      title: 'Enviar mundo?',
      message: `Os arquivos de ${file.name} (${formatBytes(file.size)}) serão extraídos em /data e substituem os que tiverem o mesmo nome. O servidor precisa estar parado.`,
      confirmLabel: 'Enviar',
      confirmVariant: 'info',
    });
    if (!confirmed) {
      return;
    }
    this.uploading.set(true);
    this.files.uploadWorld(this.id(), file).subscribe({
      next: ({ extractedCount }) => {
        this.uploading.set(false);
        this.toast.success(`Mundo enviado: ${extractedCount} itens extraídos.`);
        this.closeFile();
        this.reload();
      },
      error: (error) => {
        this.uploading.set(false);
        this.uploadError.set(fileErrorMessage('upload', error));
      },
    });
  }

  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  private load(path: string): void {
    this.listLoading.set(true);
    this.listError.set('');
    this.files.list(this.id(), path).subscribe({
      next: (listing) => {
        this.currentPath.set(path);
        this.listing.set(listing.files);
        this.listLoading.set(false);
      },
      error: (error) => {
        this.listError.set(fileErrorMessage('list', error));
        this.listLoading.set(false);
      },
    });
  }

  private closeFile(): void {
    this.selected.set(null);
    this.content.set('');
    this.original.set('');
    this.notice.set('');
    this.fileError.set('');
    this.fileLoading.set(false);
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty()) {
      return true;
    }
    return this.dialogs.confirm({
      title: 'Descartar alterações?',
      message: `Há alterações não salvas em ${this.selected()?.name}. Se continuar, elas serão perdidas.`,
      confirmLabel: 'Descartar',
    });
  }
}
