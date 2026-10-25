import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  AdminApi,
  Group,
  ServerSummary,
  ServersApi,
  UserSummary,
  UserWorldAccess,
} from '../../core/api';
import { ToastService } from '../../ui';
import { UserDetailPage } from './user-detail.page';

describe('UserDetailPage (#212)', () => {
  let fixture: ComponentFixture<UserDetailPage>;
  let el: HTMLElement;

  const mockUser: UserSummary = {
    id: 'u-1',
    minecraftNick: 'Steve',
    realName: 'Steve Jobs',
    email: 'steve@example.com',
    githubUsername: 'steve',
    linked: true,
    role: 'PLAYER',
    devices: [
      {
        id: 'd-1',
        deviceName: 'Notebook Steve',
        status: 'ACTIVE',
        lastSeenAt: '2026-10-24T12:00:00.000Z',
      },
    ],
    groupIds: ['g-vip'],
    serverIds: ['s-direct'],
  };

  const mockGroups: Group[] = [
    {
      id: 'g-vip',
      name: 'VIP',
      description: null,
      created_at: '2026-10-24T00:00:00.000Z',
      user_groups: [{ group_id: 'g-vip', user_id: 'u-1' }],
      server_groups: [],
    },
    {
      id: 'g-mods',
      name: 'Moderadores',
      description: null,
      created_at: '2026-10-24T00:00:00.000Z',
      user_groups: [],
      server_groups: [],
    },
  ];

  const mockServers: Partial<ServerSummary>[] = [
    { id: 's-1', name: 'Survival' },
    { id: 's-2', name: 'Criativo' },
    { id: 's-3', name: 'Minigames' },
    { id: 's-direct', name: 'Hardcore' },
    { id: 's-5', name: 'Skyblock' },
    { id: 's-6', name: 'Factions' },
    { id: 's-7', name: 'Anarchy' },
  ];

  const mockWorldAccessList: UserWorldAccess[] = [
    {
      id: 's-1',
      name: 'Mundo Admin',
      subdomain: 'admin',
      state: 'READY',
      access_policy: 'GROUP',
      is_maintenance: false,
      allowed: true,
      reason: 'ADMIN_BYPASS',
      grantedBy: { kind: 'ADMIN' },
    },
    {
      id: 's-2',
      name: 'Mundo Público',
      subdomain: 'public',
      state: 'READY',
      access_policy: 'PUBLIC',
      is_maintenance: false,
      allowed: true,
      reason: 'POLICY_PUBLIC',
      grantedBy: { kind: 'POLICY', policy: 'PUBLIC' },
    },
    {
      id: 's-3',
      name: 'Mundo VIP',
      subdomain: 'vip',
      state: 'READY',
      access_policy: 'GROUP',
      is_maintenance: false,
      allowed: true,
      reason: 'GROUP_MATCH',
      grantedBy: { kind: 'GROUP', groupIds: ['g-vip'], groupNames: ['VIP'] },
    },
    {
      id: 's-direct',
      name: 'Mundo Direto',
      subdomain: 'direct',
      state: 'READY',
      access_policy: 'INDIVIDUAL',
      is_maintenance: false,
      allowed: true,
      reason: 'INDIVIDUAL_ALLOWED',
      grantedBy: { kind: 'DIRECT' },
    },
    {
      id: 's-5',
      name: 'Mundo Manutenção',
      subdomain: 'maint',
      state: 'STOPPED',
      access_policy: 'GROUP',
      is_maintenance: true,
      allowed: false,
      reason: 'MAINTENANCE_MODE',
      grantedBy: null,
    },
    {
      id: 's-6',
      name: 'Mundo Insuficiente',
      subdomain: 'insuf',
      state: 'READY',
      access_policy: 'GROUP',
      is_maintenance: false,
      allowed: false,
      reason: 'INSUFFICIENT_GROUPS',
      grantedBy: null,
    },
    {
      id: 's-7',
      name: 'Mundo Negado Direto',
      subdomain: 'no-direct',
      state: 'READY',
      access_policy: 'INDIVIDUAL',
      is_maintenance: false,
      allowed: false,
      reason: 'INDIVIDUAL_ACCESS_DENIED',
      grantedBy: null,
    },
  ];

  async function createComponent(options?: {
    explainUserAccessFn?: () => any;
    addUserToGroupFn?: () => any;
    removeUserFromGroupFn?: () => any;
  }) {
    const listUsers = vi.fn(() => of([mockUser]));
    const listGroups = vi.fn(() => of(mockGroups));
    const listServers = vi.fn(() => of(mockServers));
    const explainUserAccess = options?.explainUserAccessFn ?? vi.fn(() => of(mockWorldAccessList));
    const addUserToGroup = options?.addUserToGroupFn ?? vi.fn(() => of({ success: true }));
    const removeUserFromGroup =
      options?.removeUserFromGroupFn ?? vi.fn(() => of({ kickedServers: [] }));
    const grantUserServer = vi.fn(() => of({ success: true }));
    const revokeUserServer = vi.fn(() => of({ kickedServers: [] }));

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AdminApi,
          useValue: {
            listUsers,
            listGroups,
            explainUserAccess,
            addUserToGroup,
            removeUserFromGroup,
            grantUserServer,
            revokeUserServer,
          },
        },
        {
          provide: ServersApi,
          useValue: {
            list: listServers,
          },
        },
        {
          provide: ToastService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserDetailPage);
    fixture.componentRef.setInput('id', 'u-1');
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement;

    return {
      adminApi: TestBed.inject(AdminApi),
      fixture,
    };
  }

  it('renders user profile, devices, and Tailscale status', async () => {
    await createComponent();

    expect(el.textContent).toContain('Steve');
    expect(el.textContent).toContain('Steve Jobs');
    expect(el.textContent).toContain('steve@example.com');
    expect(el.textContent).toContain('@steve');
    expect(el.textContent).toContain('Conta Tailscale ligada');
    expect(el.textContent).toContain('Notebook Steve');
    expect(el.textContent).toContain('Ativo');
  });

  it('renders localized Portuguese reasons for every grantedBy and reason code', async () => {
    await createComponent();

    expect(el.textContent).toContain('Administrador (acesso a todos os mundos)');
    expect(el.textContent).toContain('Mundo público');
    expect(el.textContent).toContain('Pelo grupo VIP');
    expect(el.textContent).toContain('Acesso direto');
    expect(el.textContent).toContain('Mundo em manutenção');
    expect(el.textContent).toContain('Nenhum grupo do jogador tem este mundo');
    expect(el.textContent).toContain('Sem acesso direto a este mundo');
  });

  it('toggles a group and updates the worlds table reactively without page reload', async () => {
    let callCount = 0;
    const updatedWorldAccessList: UserWorldAccess[] = mockWorldAccessList.map((w) =>
      w.id === 's-6'
        ? {
            ...w,
            allowed: true,
            reason: 'GROUP_MATCH',
            grantedBy: { kind: 'GROUP', groupIds: ['g-mods'], groupNames: ['Moderadores'] },
          }
        : w,
    );

    const explainUserAccessFn = vi.fn(() => {
      callCount++;
      return of(callCount > 1 ? updatedWorldAccessList : mockWorldAccessList);
    });

    const addUserToGroupFn = vi.fn(() => of({ success: true }));

    await createComponent({ explainUserAccessFn, addUserToGroupFn });

    // Initial check: World s-6 is denied
    expect(el.textContent).toContain('Nenhum grupo do jogador tem este mundo');

    // Find the toggle button for Moderadores
    const buttons = Array.from(el.querySelectorAll('button'));
    const modsBtn = buttons.find((b) => b.textContent?.includes('Moderadores'));
    expect(modsBtn).toBeDefined();

    modsBtn!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(addUserToGroupFn).toHaveBeenCalledWith('g-mods', 'u-1');
    expect(explainUserAccessFn).toHaveBeenCalledTimes(2);

    // After toggle and refresh, the table now displays the updated reason for s-6
    expect(el.textContent).toContain('Pelo grupo Moderadores');
  });
});
