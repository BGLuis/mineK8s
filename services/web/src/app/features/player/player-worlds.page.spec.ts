import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthSession } from '../../core/auth';
import { PlayerServer, User } from '../../core/api/models';
import { PlayerWorldsPage } from './player-worlds.page';

describe('PlayerWorldsPage (#216)', () => {
  let http: HttpTestingController;
  let navigateSpy: ReturnType<typeof vi.fn>;
  let mockUserSignal: ReturnType<typeof signal<User | null>>;
  let mockIsAdminSignal: ReturnType<typeof signal<boolean>>;
  let logoutSpy: ReturnType<typeof vi.fn>;

  const mockServers: PlayerServer[] = [
    {
      name: 'Mundo Survival',
      address: 'survival.mc.example.com',
      state: 'READY',
      playersOnline: 5,
      icon: 'data:image/png;base64,sample-icon',
    },
    {
      name: 'Mundo Criativo',
      address: 'creative.mc.example.com',
      state: 'MAINTENANCE',
      playersOnline: 0,
      icon: null,
    },
    {
      name: 'Mundo Minigames',
      address: 'minigames.mc.example.com',
      state: 'STOPPED',
      playersOnline: 0,
      icon: null,
    },
  ];

  async function setup(role: 'PLAYER' | 'ADMIN' = 'PLAYER') {
    mockUserSignal = signal<User | null>({
      id: 'u-123',
      minecraft_nick: 'PlayerSteve',
      role,
      real_name: 'Steve',
      email: null,
      tailscale_user_id: '42',
      created_at: '',
      updated_at: '',
    });
    mockIsAdminSignal = signal<boolean>(role === 'ADMIN');
    logoutSpy = vi.fn();

    const mockAuthSession = {
      user: mockUserSignal,
      isAdmin: mockIsAdminSignal,
      logout: logoutSpy,
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthSession, useValue: mockAuthSession },
      ],
    });

    const router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PlayerWorldsPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => {
    http.verify();
  });

  it('renders player nick and worlds list from GET /api/me/servers', async () => {
    const { fixture, el } = await setup('PLAYER');

    const req = http.expectOne('/api/me/servers');
    expect(req.request.method).toBe('GET');
    req.flush(mockServers);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="player-nick"]')?.textContent).toContain('PlayerSteve');

    const worldCards = el.querySelectorAll('[data-testid="player-worlds-list"] > mc-panel');
    expect(worldCards.length).toBe(3);

    // World 1: READY -> "Pronto"
    expect(worldCards[0].textContent).toContain('Mundo Survival');
    expect(worldCards[0].textContent).toContain('Pronto');
    expect(worldCards[0].textContent).toContain('5 jogadores online');
    expect(worldCards[0].textContent).toContain('survival.mc.example.com');
    const iconImg = worldCards[0].querySelector('img');
    expect(iconImg?.getAttribute('src')).toBe('data:image/png;base64,sample-icon');

    // World 2: MAINTENANCE -> "Em manutenção"
    expect(worldCards[1].textContent).toContain('Mundo Criativo');
    expect(worldCards[1].textContent).toContain('Em manutenção');
    expect(worldCards[1].textContent).toContain('0 jogadores online');
    expect(worldCards[1].textContent).toContain('creative.mc.example.com');

    // World 3: STOPPED -> "Hibernando"
    expect(worldCards[2].textContent).toContain('Mundo Minigames');
    expect(worldCards[2].textContent).toContain('Hibernando');
  });

  it('renders empty state when player has no accessible worlds', async () => {
    const { fixture, el } = await setup('PLAYER');

    http.expectOne('/api/me/servers').flush([]);
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="empty-worlds"]')).not.toBeNull();
    expect(el.textContent).toContain('Nenhum mundo disponível');
  });

  it('copies server address to clipboard when "Copiar endereço" is clicked', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    const { fixture, el } = await setup('PLAYER');

    http.expectOne('/api/me/servers').flush(mockServers);
    fixture.detectChanges();

    const copyBtn = el.querySelector('mc-button') as HTMLButtonElement;
    const allButtons = Array.from(el.querySelectorAll('button'));
    const copyAddressBtn = allButtons.find((b) => b.textContent?.includes('Copiar endereço'));
    expect(copyAddressBtn).toBeDefined();

    copyAddressBtn?.click();
    fixture.detectChanges();

    expect(writeTextSpy).toHaveBeenCalledWith('survival.mc.example.com');
    expect(copyAddressBtn?.textContent).toContain('Copiado!');
  });

  it('hides admin link for PLAYER users', async () => {
    const { fixture, el } = await setup('PLAYER');
    http.expectOne('/api/me/servers').flush(mockServers);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="admin-dashboard-link"]')).toBeNull();
  });

  it('shows admin link for ADMIN users', async () => {
    const { fixture, el } = await setup('ADMIN');
    http.expectOne('/api/me/servers').flush(mockServers);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="admin-dashboard-link"]')).not.toBeNull();
  });

  it('logs out and navigates to /login when Sair is clicked', async () => {
    const { fixture, el } = await setup('PLAYER');
    http.expectOne('/api/me/servers').flush(mockServers);
    fixture.detectChanges();

    const allButtons = Array.from(el.querySelectorAll('button'));
    const logoutBtn = allButtons.find((b) => b.textContent?.includes('Sair'));
    expect(logoutBtn).toBeDefined();

    logoutBtn?.click();
    fixture.detectChanges();

    expect(logoutSpy).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });
});
