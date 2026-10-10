import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { MinecraftServerSettings } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import { ServerDetailStore } from '../server-detail.store';
import { ServerWorldPage } from './server-world.page';

const SETTINGS: MinecraftServerSettings = {
  motd: 'Mundo do Lucas',
  max_players: 20,
  difficulty: 'normal',
  gamemode: 'survival',
  hardcore: false,
  pvp: true,
  spawn_protection: 16,
  view_distance: 10,
  simulation_distance: 10,
  enable_rcon: true,
  rcon_port: 25575,
  enforce_secure_chat: false,
  online_mode: false,
  language: 'pt-BR',
};

describe('ServerWorldPage', () => {
  let updateSettings: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ServerWorldPage>;
  let el: HTMLElement;

  async function render(state: string, accessPolicy = 'PUBLIC') {
    updateSettings = vi.fn(() => of({}));
    refresh = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: ServersApi, useValue: { updateSettings } },
        {
          provide: ServerDetailStore,
          useValue: {
            server: signal({ id: 'srv-1', name: 'Hub', state, settings: SETTINGS }),
            accessPolicy: signal(accessPolicy),
            refresh,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ServerWorldPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
  }

  const field = (label: string) => {
    const wrapper = Array.from(el.querySelectorAll('mc-text-field')).find((f) =>
      f.textContent?.includes(label),
    );
    return wrapper!.querySelector('input') as HTMLInputElement;
  };
  const saveButton = () =>
    Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Salvar configurações'),
    ) as HTMLButtonElement;

  async function type(label: string, value: string) {
    const target = field(label);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('loads the settings of the server into the form and keeps save disabled until something changes', async () => {
    await render('STOPPED');

    expect(field('MOTD').value).toBe('Mundo do Lucas');
    expect(field('Máximo de jogadores').value).toBe('20');
    expect(saveButton().disabled).toBe(true);
  });

  it('sends only what changed to PATCH /settings', async () => {
    await render('STOPPED');

    await type('Máximo de jogadores', '8');
    saveButton().click();
    await fixture.whenStable();

    expect(updateSettings).toHaveBeenCalledWith('srv-1', { max_players: 8 });
    expect(refresh).toHaveBeenCalled();
  });

  it('sends the language of the gateway messages when it is changed', async () => {
    await render('STOPPED');
    const wrapper = Array.from(el.querySelectorAll('mc-select')).find((f) =>
      f.textContent?.includes('Idioma'),
    );
    const select = wrapper?.querySelector('select') as HTMLSelectElement;

    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    saveButton().click();
    await fixture.whenStable();

    expect(updateSettings).toHaveBeenCalledWith('srv-1', { language: 'en' });
  });

  it('does not save an invalid value', async () => {
    await render('STOPPED');

    await type('Distância de visão', '99');

    expect(saveButton().disabled).toBe(true);
    expect(el.textContent).toContain('Informe um número inteiro de 2 a 32.');
  });

  it('tells the admin to restart when the server is up, and not when it is stopped', async () => {
    await render('READY');
    await type('Máximo de jogadores', '8');
    saveButton().click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Reinicie para aplicar');
  });

  it('shows no restart notice after saving a stopped server', async () => {
    await render('STOPPED');
    await type('Máximo de jogadores', '8');
    saveButton().click();
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Reinicie para aplicar');
  });

  it('locks online-mode while the world is published on the internet', async () => {
    await render('STOPPED', 'INTERNET');

    expect(el.textContent).toContain('Obrigatório enquanto o mundo estiver publicado');
  });
});
