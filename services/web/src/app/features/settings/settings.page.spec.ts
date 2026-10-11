import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SettingsSnapshot } from '../../core/api';
import { SettingsPage } from './settings.page';

const FAKE_API_KEY = 'tskey-api-FAKE-0000000000';

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    sections: [
      {
        id: 'tailscale',
        title: 'Tailscale',
        description: 'Como a rede privada identifica e recebe os jogadores.',
        settings: [
          {
            key: 'tailscale.apiKey',
            type: 'secret',
            label: 'Chave de API do Tailscale',
            description: 'Só é gravada.',
            envName: 'TAILSCALE_API_KEY',
            source: 'database',
            isSet: true,
            updatedBy: 'AdminSteve',
            updatedAt: new Date(2026, 9, 11, 8, 30).toISOString(),
          },
          {
            key: 'tailscale.tailnet',
            type: 'text',
            label: 'Nome da tailnet',
            description: 'O nome da sua tailnet.',
            envName: 'TAILNET_NAME',
            source: 'environment',
            value: 'exemplo.ts.net',
            defaultValue: '-',
          },
          {
            key: 'tailscale.inviteKeyEnabled',
            type: 'boolean',
            label: 'Convite com chave de acesso',
            description: 'Fica desligado.',
            envName: 'TAILSCALE_INVITE_KEY_ENABLED',
            source: 'default',
            value: false,
            defaultValue: false,
          },
        ],
      },
      {
        id: 'cloudflare',
        title: 'Cloudflare',
        description: 'DNS dos mundos publicados.',
        settings: [
          {
            key: 'cloudflare.apiToken',
            type: 'secret',
            label: 'Token da Cloudflare',
            description: 'Só é gravado.',
            envName: 'CLOUDFLARE_API_TOKEN',
            source: 'default',
            isSet: false,
          },
        ],
      },
      {
        id: 'healthBot',
        title: 'Bot de saúde',
        description: 'Teste periódico.',
        settings: [
          {
            key: 'healthBot.intervalMs',
            type: 'integer',
            label: 'Intervalo entre testes (ms)',
            description: 'Tempo entre ciclos.',
            envName: 'HEALTH_BOT_INTERVAL_MS',
            source: 'default',
            value: 300000,
            defaultValue: 300000,
            min: 1000,
            max: 86400000,
          },
        ],
      },
    ],
    readOnly: [
      { key: 'port', label: 'Porta do painel e da API', envName: 'PORT', value: '8080' },
      {
        key: 'trustedProxyIps',
        label: 'Origens confiáveis da tailnet',
        envName: 'TRUSTED_PROXY_IPS',
        value: '127.0.0.1/32, 100.64.0.0/10',
      },
    ],
    ...overrides,
  };
}

describe('SettingsPage', () => {
  let http: HttpTestingController;

  async function setup(response: SettingsSnapshot | { status: number; body: object } = snapshot()) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const request = http.expectOne('/api/settings');
    if ('status' in response) {
      request.flush(response.body, { status: response.status, statusText: 'Error' });
    } else {
      request.flush(response);
    }
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const wrapper = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLElement>(`[data-setting="${key}"]`)!;
  const input = (el: HTMLElement, key: string) =>
    wrapper(el, key).querySelector<HTMLInputElement>('input')!;
  const type = (el: HTMLElement, key: string, value: string) => {
    const field = input(el, key);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  const button = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(label),
    )!;

  afterEach(() => http.verify());

  it('renders every section with the effective value and where it comes from', async () => {
    const { el } = await setup();

    const titles = [...el.querySelectorAll('mc-panel h2')].map((h) => h.textContent?.trim());
    expect(titles).toEqual([
      'Tailscale',
      'Cloudflare',
      'Bot de saúde',
      'Diagnóstico (somente leitura)',
    ]);
    expect(input(el, 'tailscale.tailnet').value).toBe('exemplo.ts.net');
    expect(wrapper(el, 'tailscale.tailnet').textContent).toContain('Ambiente (TAILNET_NAME)');
    expect(wrapper(el, 'healthBot.intervalMs').textContent).toContain('Padrão');
    expect(wrapper(el, 'tailscale.apiKey').textContent).toContain('Salvo no painel · AdminSteve');
  });

  it('shows secrets only as set or not set, with an empty field to replace them', async () => {
    const { el } = await setup();

    const apiKey = wrapper(el, 'tailscale.apiKey');
    expect(apiKey.textContent).toContain('DEFINIDA');
    expect(apiKey.textContent).not.toContain('NÃO DEFINIDA');
    expect(input(el, 'tailscale.apiKey').type).toBe('password');
    expect(input(el, 'tailscale.apiKey').value).toBe('');
    expect(wrapper(el, 'cloudflare.apiToken').textContent).toContain('NÃO DEFINIDA');
  });

  it('marks the read-only diagnostics as needing a restart', async () => {
    const { el } = await setup();

    const items = [...el.querySelectorAll('dl > div')];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Porta do painel e da API');
    expect(items[0].textContent).toContain('8080');
    expect(items.every((item) => item.textContent?.includes('REQUER REINÍCIO'))).toBe(true);
    expect(el.querySelectorAll('dl input')).toHaveLength(0);
  });

  it('keeps Save disabled until something changes', async () => {
    const { fixture, el } = await setup();
    expect(button(el, 'Salvar alterações').disabled).toBe(true);
    expect(el.textContent).toContain('Nenhuma alteração pendente.');

    type(el, 'tailscale.tailnet', 'outra.ts.net');
    fixture.detectChanges();

    expect(button(el, 'Salvar alterações').disabled).toBe(false);
    expect(el.textContent).toContain('1 alteração pendente.');
  });

  it('sends only what changed, then shows the saved snapshot', async () => {
    const { fixture, el } = await setup();

    type(el, 'tailscale.tailnet', 'outra.ts.net');
    type(el, 'healthBot.intervalMs', '300000');
    wrapper(el, 'tailscale.inviteKeyEnabled')
      .querySelector<HTMLButtonElement>('button[role="switch"]')!
      .click();
    fixture.detectChanges();
    button(el, 'Salvar alterações').click();

    const patch = http.expectOne('/api/settings');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      values: { 'tailscale.tailnet': 'outra.ts.net', 'tailscale.inviteKeyEnabled': true },
    });
    const saved = snapshot();
    saved.sections[0].settings[1] = {
      ...saved.sections[0].settings[1],
      source: 'database',
      value: 'outra.ts.net',
    };
    patch.flush(saved);
    await fixture.whenStable();

    expect(input(el, 'tailscale.tailnet').value).toBe('outra.ts.net');
    expect(wrapper(el, 'tailscale.tailnet').textContent).toContain('Salvo no painel');
    expect(el.textContent).toContain('Nenhuma alteração pendente.');
  });

  it('sends a typed secret once, and clears the field afterwards', async () => {
    const { fixture, el } = await setup();

    type(el, 'cloudflare.apiToken', FAKE_API_KEY);
    fixture.detectChanges();
    button(el, 'Salvar alterações').click();

    const patch = http.expectOne('/api/settings');
    expect(patch.request.body).toEqual({ values: { 'cloudflare.apiToken': FAKE_API_KEY } });
    const saved = snapshot();
    saved.sections[1].settings[0] = { ...saved.sections[1].settings[0], isSet: true };
    patch.flush(saved);
    await fixture.whenStable();

    expect(input(el, 'cloudflare.apiToken').value).toBe('');
    expect(el.textContent).not.toContain(FAKE_API_KEY);
    expect(wrapper(el, 'cloudflare.apiToken').textContent).toContain('DEFINIDA');
  });

  it('lets a saved value go back to the environment', async () => {
    const { fixture, el } = await setup();

    button(el, 'Voltar ao ambiente ou ao padrão').click();
    fixture.detectChanges();
    expect(wrapper(el, 'tailscale.apiKey').textContent).toContain('será removido ao salvar');
    button(el, 'Salvar alterações').click();

    expect(http.expectOne('/api/settings').request.body).toEqual({
      values: { 'tailscale.apiKey': null },
    });
  });

  it('blocks an invalid interval before calling the API', async () => {
    const { fixture, el } = await setup();

    type(el, 'healthBot.intervalMs', '10');
    fixture.detectChanges();

    expect(wrapper(el, 'healthBot.intervalMs').textContent).toContain('número inteiro');
    expect(button(el, 'Salvar alterações').disabled).toBe(true);
  });

  it('shows the reason when the server rejects the values, keeping what was typed', async () => {
    const { fixture, el } = await setup();

    type(el, 'tailscale.tailnet', 'outra.ts.net');
    fixture.detectChanges();
    button(el, 'Salvar alterações').click();
    http
      .expectOne('/api/settings')
      .flush(
        { code: 'VALIDATION_ERROR', message: 'Nome da tailnet: use o nome da tailnet.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('mc-banner')?.textContent).toContain('Nome da tailnet: use o nome');
    expect(input(el, 'tailscale.tailnet').value).toBe('outra.ts.net');
  });

  it('discards pending edits', async () => {
    const { fixture, el } = await setup();

    type(el, 'tailscale.tailnet', 'outra.ts.net');
    fixture.detectChanges();
    button(el, 'Descartar').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(input(el, 'tailscale.tailnet').value).toBe('exemplo.ts.net');
    expect(button(el, 'Salvar alterações').disabled).toBe(true);
  });

  it('explains a load failure and can try again', async () => {
    const { fixture, el } = await setup({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(el.querySelector('mc-banner')?.textContent).toContain(
      'Não foi possível carregar as configurações',
    );

    button(el, 'Tentar de novo').click();
    http.expectOne('/api/settings').flush(snapshot());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('mc-banner')).toBeNull();
    expect(el.querySelectorAll('mc-panel')).toHaveLength(4);
  });
});
