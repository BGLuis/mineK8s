import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { FilesApi } from '../../../core/api/files.api';
import { ServersApi } from '../../../core/api/servers.api';
import { DialogService, ToastService } from '../../../ui';
import { ServerFilesPage } from './server-files.page';

describe('ServerFilesPage', () => {
  let fixture: ComponentFixture<ServerFilesPage>;
  let component: ServerFilesPage;
  let filesApi: any;
  let serversApi: any;
  let toast: ToastService;

  beforeEach(async () => {
    filesApi = {
      list: vi.fn().mockReturnValue(
        of({
          path: '',
          files: [
            {
              name: 'server.properties',
              path: 'server.properties',
              isDirectory: false,
              size: 100,
              modifiedAt: '2026-10-09',
            },
            {
              name: 'config',
              path: 'config',
              isDirectory: true,
              size: 0,
              modifiedAt: '2026-10-09',
            },
          ],
        }),
      ),
      read: vi
        .fn()
        .mockReturnValue(of({ path: 'server.properties', content: 'server-port=25565\n' })),
      write: vi.fn().mockReturnValue(of({ message: 'Saved successfully' })),
      delete: vi.fn().mockReturnValue(of({ message: 'Removed successfully' })),
      uploadFile: vi.fn().mockReturnValue(of({ message: 'File uploaded successfully' })),
      createFolder: vi.fn().mockReturnValue(of({ message: 'Directory created successfully' })),
      rename: vi.fn().mockReturnValue(of({ message: 'Renamed successfully' })),
      uploadWorld: vi.fn().mockReturnValue(of({ message: 'World uploaded', extractedCount: 5 })),
    };

    serversApi = {
      get: vi.fn().mockReturnValue(of({ id: 'srv-1', name: 'Server 1', state: 'STOPPED' })),
    };

    await TestBed.configureTestingModule({
      imports: [ServerFilesPage],
      providers: [
        { provide: FilesApi, useValue: filesApi },
        { provide: ServersApi, useValue: serversApi },
      ],
    }).compileComponents();

    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(ServerFilesPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'srv-1');
    fixture.detectChanges();
  });

  it('renders files list and does not render the no-api-tag for upload/mkdir/rename', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('server.properties');
    expect(el.textContent).toContain('config');
    expect(el.textContent).not.toContain('upload avulso, nova pasta, renomear');
  });

  it('creates a new folder via FilesApi.createFolder', () => {
    component['folderName'].set('plugins');
    component['createFolder']();

    expect(filesApi.createFolder).toHaveBeenCalledWith('srv-1', '', 'plugins');
  });

  it('uploads a single file via FilesApi.uploadFile', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const event = { target: { files: [file], value: '' } } as unknown as Event;

    component['onSingleFileChosen'](event);

    expect(filesApi.uploadFile).toHaveBeenCalledWith('srv-1', '', file);
  });

  it('renames a file via FilesApi.rename', () => {
    component['openRenameDialog']({
      name: 'server.properties',
      path: 'server.properties',
      isDirectory: false,
      size: 100,
      modifiedAt: '2026-10-09',
    });
    component['renameValue'].set('server.properties.bak');
    component['confirmRename']();

    expect(filesApi.rename).toHaveBeenCalledWith(
      'srv-1',
      'server.properties',
      'server.properties.bak',
    );
  });
});
