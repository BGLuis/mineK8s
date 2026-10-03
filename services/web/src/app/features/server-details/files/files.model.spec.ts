import { HttpErrorResponse } from '@angular/common/http';

import { FileItem } from '../../../core/api/models';
import {
  breadcrumbs,
  fileErrorMessage,
  isWorldArchive,
  parentPath,
  sortEntries,
} from './files.model';

const item = (name: string, isDirectory: boolean): FileItem => ({
  name,
  path: name,
  isDirectory,
  size: 0,
  modifiedAt: '',
});

describe('sortEntries', () => {
  it('lists folders first, then files, each alphabetically', () => {
    const sorted = sortEntries([
      item('server.properties', false),
      item('world', true),
      item('Config', true),
      item('bukkit.yml', false),
    ]);
    expect(sorted.map((f) => f.name)).toEqual([
      'Config',
      'world',
      'bukkit.yml',
      'server.properties',
    ]);
  });
});

describe('paths', () => {
  it('builds clickable breadcrumbs from /data', () => {
    expect(breadcrumbs('plugins/Essentials')).toEqual([
      { label: '/data', path: '' },
      { label: 'plugins', path: 'plugins' },
      { label: 'Essentials', path: 'plugins/Essentials' },
    ]);
    expect(breadcrumbs('')).toHaveLength(1);
  });

  it('finds the parent folder', () => {
    expect(parentPath('plugins/Essentials')).toBe('plugins');
    expect(parentPath('plugins')).toBe('');
  });

  it('accepts only the archive formats the backend extracts', () => {
    for (const name of ['w.zip', 'w.tar', 'w.tar.gz', 'W.TGZ']) {
      expect(isWorldArchive(name)).toBe(true);
    }
    for (const name of ['w.rar', 'w.gz', 'w.7z', 'world']) {
      expect(isWorldArchive(name)).toBe(false);
    }
  });
});

describe('fileErrorMessage', () => {
  const http = (status: number, message?: string) =>
    new HttpErrorResponse({ status, error: message ? { message } : null });

  it('tells the user to stop the server on a 409 upload', () => {
    expect(fileErrorMessage('upload', http(409))).toContain('Pare o servidor');
  });

  it('explains a 409 on world files differently from an upload', () => {
    expect(fileErrorMessage('write', http(409))).toContain('servidor parado');
  });

  it('explains path violations on 403', () => {
    expect(fileErrorMessage('read', http(403))).toContain('link simbólico');
  });

  it('translates the session.lock refusal', () => {
    expect(fileErrorMessage('delete', http(400, 'session.lock nunca deve ser deletado'))).toContain(
      'session.lock',
    );
  });

  it('lists the accepted formats when an upload is refused with 400', () => {
    expect(fileErrorMessage('upload', http(400))).toContain('.tar.gz');
  });
});
