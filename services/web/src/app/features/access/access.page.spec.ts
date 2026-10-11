import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SettingsSnapshot } from '../../core/api';
import { AccessPage } from './access.page';

const settings = (inviteKeyEnabled: boolean): SettingsSnapshot => ({
  sections: [
    {
      id: 'tailscale',
      title: 'Tailscale',
      description: '',
      settings: [
        {
          key: 'tailscale.inviteKeyEnabled',
          type: 'boolean',
          label: 'Convite com chave de acesso',
          description: '',
          envName: 'TAILSCALE_INVITE_KEY_ENABLED',
          source: 'default',
          value: inviteKeyEnabled,
        },
      ],
    },
  ],
  readOnly: [],
});

describe('AccessPage', () => {
  let http: HttpTestingController;

  async function render(settingsResponse: SettingsSnapshot | 'error') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AccessPage);
    fixture.detectChanges();

    for (const url of [
      '/api/servers',
      '/api/admin/groups',
      '/api/tailscale/invites',
      '/api/tailscale/devices',
      '/api/admin/users',
    ]) {
      for (const req of http.match((r) => r.url.startsWith(url))) {
        req.flush([]);
      }
    }
    const request = http.expectOne('/api/settings');
    if (settingsResponse === 'error') {
      request.flush({ code: 'FORBIDDEN' }, { status: 500, statusText: 'Error' });
    } else {
      request.flush(settingsResponse);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    http.match(() => true);
  });

  it('hides invite creation and explains why when key invites are off', async () => {
    const el = await render(settings(false));

    expect(el.querySelector('mc-invite-form')).toBeNull();
    expect(el.querySelector('mc-banner')?.textContent).toContain(
      'Convites com chave de acesso desativados',
    );
    expect(el.querySelector('mc-banner a')?.getAttribute('href')).toBe('/settings');
    expect(el.querySelector('mc-invite-list')).not.toBeNull();
  });

  it('offers invite creation when key invites are on', async () => {
    const el = await render(settings(true));

    expect(el.querySelector('mc-invite-form')).not.toBeNull();
    expect(el.querySelector('mc-banner')).toBeNull();
  });

  it('still offers it when the settings cannot be read, since the server enforces the switch', async () => {
    const el = await render('error');

    expect(el.querySelector('mc-invite-form')).not.toBeNull();
  });
});
