import { HttpErrorResponse } from '@angular/common/http';

import { FileItem } from '../../../core/api/models';

export interface Crumb {
  label: string;
  path: string;
}

export const ROOT_LABEL = '/data';
const WORLD_ARCHIVE = /\.(zip|tar|tar\.gz|tgz)$/i;

export function sortEntries(files: readonly FileItem[]): FileItem[] {
  return [...files].sort(
    (a, b) =>
      Number(b.isDirectory) - Number(a.isDirectory) ||
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

export function breadcrumbs(path: string): Crumb[] {
  const segments = path.split('/').filter(Boolean);
  return [
    { label: ROOT_LABEL, path: '' },
    ...segments.map((label, i) => ({ label, path: segments.slice(0, i + 1).join('/') })),
  ];
}

export function parentPath(path: string): string {
  return path.split('/').filter(Boolean).slice(0, -1).join('/');
}

export function isWorldArchive(name: string): boolean {
  return WORLD_ARCHIVE.test(name);
}

export type FileAction = 'list' | 'read' | 'write' | 'delete' | 'upload';

const FORBIDDEN =
  'Caminho recusado pela API: fora de /data ou link simbólico. Isso não pode ser acessado pelo painel.';

export function fileErrorMessage(action: FileAction, error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Algo deu errado. Tente novamente.';
  }
  const body = (error.error as { message?: string | string[] } | null)?.message;
  const detail = Array.isArray(body) ? body.join(' ') : (body ?? '');

  switch (error.status) {
    case 0:
      return 'Não foi possível falar com o painel. Verifique sua conexão.';
    case 403:
      return FORBIDDEN;
    case 404:
      return action === 'list'
        ? 'Essa pasta não existe mais.'
        : 'Esse arquivo não existe mais. Atualize a lista.';
    case 409:
      return action === 'upload'
        ? 'Pare o servidor antes de enviar um mundo: o envio é recusado enquanto ele está ligado.'
        : 'Arquivos do mundo só podem ser alterados com o servidor parado. Pare o servidor e tente de novo.';
    case 413:
      return 'O arquivo é maior que o limite aceito pelo servidor.';
    case 400:
      if (/session\.lock/i.test(detail)) {
        return 'O arquivo session.lock não pode ser alterado manualmente.';
      }
      return action === 'upload'
        ? 'Arquivo recusado. Envie um .zip, .tar, .tar.gz ou .tgz que não esteja vazio.'
        : 'O pedido foi recusado pelo servidor.';
    default:
      return 'Algo deu errado no servidor. Tente novamente.';
  }
}
