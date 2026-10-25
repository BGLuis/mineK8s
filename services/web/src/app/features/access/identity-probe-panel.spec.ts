import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminApi, IdentityProbeResult } from '../../core/api';
import { AccessStore } from './access.store';
import { IdentityProbePanel } from './identity-probe-panel';

describe('IdentityProbePanel (#215)', () => {
  let fixture: ComponentFixture<IdentityProbePanel>;
  let component: IdentityProbePanel;
  let adminApi: Partial<AdminApi>;
  let probePrefillSignal: ReturnType<
    typeof signal<{ tailscaleUserId?: string; ip?: string; minecraftNick?: string } | null>
  >;

  const mockSuccessResult: IdentityProbeResult = {
    whois: {
      userId: 'ts-u-123',
      loginName: 'amigo@example.com',
      displayName: 'Amigo',
      nodeId: 'node-pc-1',
      nodeName: 'pc-amigo',
      nodeIp: '100.88.1.1',
      tags: ['tag:mc-player'],
      isOwner: false,
    },
    user: {
      id: 'u-1',
      minecraftNick: 'Steve',
      realName: 'Steve Rogers',
      email: 'amigo@example.com',
      githubUsername: null,
      role: 'PLAYER',
    },
    matchedBy: 'SHARED_EMAIL',
    wouldBind: true,
    nicknameCheck: {
      allowed: true,
      autoAdopted: false,
    },
    servers: [
      {
        id: 's-1',
        name: 'Survival',
        subdomain: 'survival',
        state: 'READY',
        access_policy: 'GROUP',
        is_maintenance: false,
        allowed: true,
        reason: 'GROUP_MATCH',
        grantedBy: { kind: 'GROUP', groupIds: ['g-1'], groupNames: ['Membros'] },
      },
      {
        id: 's-2',
        name: 'Criativo',
        subdomain: 'criativo',
        state: 'READY',
        access_policy: 'INDIVIDUAL',
        is_maintenance: false,
        allowed: false,
        reason: 'INDIVIDUAL_ACCESS_DENIED',
        grantedBy: null,
      },
    ],
  };

  const mockImpersonationResult: IdentityProbeResult = {
    whois: {
      userId: 'ts-hacker',
      loginName: 'hacker@example.com',
      nodeId: 'node-hacker',
      nodeIp: '100.88.1.99',
    },
    user: {
      id: 'u-1',
      minecraftNick: 'Steve',
      realName: 'Steve Rogers',
      email: 'hacker@example.com',
      githubUsername: null,
      role: 'PLAYER',
    },
    matchedBy: 'SHARED_EMAIL',
    wouldBind: false,
    nicknameCheck: {
      allowed: false,
      autoAdopted: false,
      reason: 'IMPERSONATION_DETECTED',
    },
    servers: [],
  };

  async function setup(probeResult: IdentityProbeResult = mockSuccessResult) {
    adminApi = {
      probeIdentity: vi.fn(() => of(probeResult)),
    };

    probePrefillSignal = signal<{
      tailscaleUserId?: string;
      ip?: string;
      minecraftNick?: string;
    } | null>(null);

    const mockStore = {
      probePrefill: probePrefillSignal,
      prefillIdentityProbe: vi.fn((data) => probePrefillSignal.set(data)),
    };

    await TestBed.configureTestingModule({
      imports: [IdentityProbePanel],
      providers: [
        provideRouter([]),
        { provide: AdminApi, useValue: adminApi },
        { provide: AccessStore, useValue: mockStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IdentityProbePanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders inputs and tests identity probe on form submit', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;

    component.ip.set('100.88.1.1');
    component.minecraftNick.set('Steve');
    fixture.detectChanges();

    const submitBtn = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(false);

    submitBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(adminApi.probeIdentity).toHaveBeenCalledWith({
      tailscaleUserId: undefined,
      ip: '100.88.1.1',
      minecraftNick: 'Steve',
    });

    // WhoIs displayed
    expect(el.textContent).toContain('Identidade de Rede (WhoIs)');
    expect(el.textContent).toContain('amigo@example.com');
    expect(el.textContent).toContain('pc-amigo');
    expect(el.textContent).toContain('100.88.1.1');
    expect(el.textContent).toContain('tag:mc-player');

    // Recognized user displayed with Portuguese matchedBy
    expect(el.textContent).toContain('Jogador Reconhecido');
    expect(el.textContent).toContain('Steve');
    expect(el.textContent).toContain('E-mail do nó compartilhado coincide com o cadastro');
    expect(el.textContent).toContain('Primeiro login vinculará a conta');

    // Anti-impersonation check displayed
    expect(el.textContent).toContain('Anti-Impersonação');
    expect(el.textContent).toContain('Nickname verificado');

    // Worlds table with reasons
    expect(el.textContent).toContain('Acesso aos Mundos');
    expect(el.textContent).toContain('Survival');
    expect(el.textContent).toContain('Pelo grupo Membros');
    expect(el.textContent).toContain('Criativo');
    expect(el.textContent).toContain('Sem acesso direto a este mundo');
  });

  it('displays impersonation warning when nickname does not match registered user', async () => {
    await setup(mockImpersonationResult);
    const el = fixture.nativeElement as HTMLElement;

    component.ip.set('100.88.1.99');
    component.minecraftNick.set('ImpostorSteve');
    fixture.detectChanges();

    const submitBtn = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Tentativa de impersonação detectada');
    expect(el.textContent).toContain('o nickname declarado não confere com o registrado');
  });

  it('reacts to store.probePrefill to populate fields and trigger probe automatically', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;

    probePrefillSignal.set({
      tailscaleUserId: 'ts-u-from-unlinked',
      ip: '100.64.0.77',
      minecraftNick: 'UnlinkedNick',
    });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.tailscaleUserId()).toBe('ts-u-from-unlinked');
    expect(component.ip()).toBe('100.64.0.77');
    expect(component.minecraftNick()).toBe('UnlinkedNick');

    expect(adminApi.probeIdentity).toHaveBeenCalledWith({
      tailscaleUserId: 'ts-u-from-unlinked',
      ip: '100.64.0.77',
      minecraftNick: 'UnlinkedNick',
    });
  });
});
