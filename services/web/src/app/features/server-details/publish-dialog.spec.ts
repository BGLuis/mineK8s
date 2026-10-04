import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ServerAccessPolicy } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { McPublishDialog } from './publish-dialog';
import { ServerDetailStore } from './server-detail.store';

describe('McPublishDialog', () => {
  const api = { publish: vi.fn(), unpublish: vi.fn() };
  const store = {
    serverId: signal<string | null>('srv-1'),
    accessPolicy: signal<ServerAccessPolicy | null>(null),
    refresh: vi.fn(),
  };

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        { provide: ServersApi, useValue: api },
        { provide: ServerDetailStore, useValue: store },
      ],
    });
    const fixture = TestBed.createComponent(McPublishDialog);
    fixture.componentRef.setInput('serverName', 'Survival');
    await fixture.whenStable();
    fixture.componentInstance.open();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const confirm = () =>
      [...el.querySelectorAll('button')].find((b) =>
        ['Publicar', 'Despublicar'].includes(b.textContent?.trim() ?? ''),
      )!;
    return { fixture, el, confirm };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    store.accessPolicy.set(null);
  });

  it('offers Despublicar for a world the API reports as INTERNET, e.g. after a reload', async () => {
    store.accessPolicy.set('INTERNET');
    api.unpublish.mockReturnValue(of({ id: 'srv-1', subdomain: 'survival', access_policy: 'GROUP' }));

    const { fixture, el, confirm } = await open();
    expect(el.querySelector('[role="dialog"] h2')?.textContent).toContain('Despublicar');
    confirm().click();
    await fixture.whenStable();

    expect(api.unpublish).toHaveBeenCalledWith('srv-1');
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('offers Publicar for a private world and never asks whether it is already published', async () => {
    store.accessPolicy.set('GROUP');
    api.publish.mockReturnValue(
      of({ id: 'srv-1', subdomain: 'survival', access_policy: 'INTERNET', srv_record: 'srv' }),
    );

    const { fixture, el, confirm } = await open();
    expect(el.querySelector('[role="dialog"] h2')?.textContent).toContain('Publicar');
    expect(el.textContent).not.toContain('já está publicado');
    confirm().click();
    await fixture.whenStable();

    expect(api.publish).toHaveBeenCalledWith('srv-1');
    expect(api.unpublish).not.toHaveBeenCalled();
  });
});
