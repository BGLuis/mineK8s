import { FileItem } from '../../../core/api/models';

export type HighlightLanguage = 'properties' | 'yaml' | 'json' | 'toml' | 'plain';

export const MAX_EDITABLE_BYTES = 256 * 1024;

const LANGUAGE_BY_EXTENSION: Record<string, HighlightLanguage> = {
  properties: 'properties',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  json5: 'json',
  mcmeta: 'json',
  toml: 'toml',
};

const BINARY_EXTENSIONS = new Set([
  'jar',
  'zip',
  'gz',
  'tgz',
  'tar',
  'xz',
  '7z',
  'rar',
  'bz2',
  'dat',
  'dat_old',
  'mca',
  'mcr',
  'nbt',
  'schematic',
  'litematic',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'ogg',
  'mp3',
  'wav',
  'class',
  'so',
  'dll',
  'exe',
  'bin',
  'db',
  'sqlite',
  'lock',
]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function languageFor(name: string): HighlightLanguage {
  return LANGUAGE_BY_EXTENSION[extensionOf(name)] ?? 'plain';
}

export type EditableCheck = { editable: true } | { editable: false; reason: string };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** Decides from the listing entry whether the file can be opened in the text editor. */
export function checkEditable(file: Pick<FileItem, 'name' | 'size'>): EditableCheck {
  if (BINARY_EXTENSIONS.has(extensionOf(file.name))) {
    return {
      editable: false,
      reason:
        'Arquivo binário: não dá para editar como texto. Use o envio de mundo para substituí-lo.',
    };
  }
  if (file.size > MAX_EDITABLE_BYTES) {
    return {
      editable: false,
      reason: `Arquivo grande demais para o editor (${formatBytes(file.size)}). O limite é ${formatBytes(MAX_EDITABLE_BYTES)}.`,
    };
  }
  return { editable: true };
}

/** The API decodes everything as UTF-8, so binary content shows up as NUL or replacement characters. */
export function looksBinary(content: string): boolean {
  if (content.includes('\u0000')) {
    return true;
  }
  const sample = content.slice(0, 8000);
  const replacements = sample.split('�').length - 1;
  return sample.length > 0 && replacements / sample.length > 0.02;
}
