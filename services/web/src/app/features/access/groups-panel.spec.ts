import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AdminApi, Group, ServerSummary, UserSummary } from '../../core/api';
import { DialogService, ToastService } from '../../ui';
import { AccessStore } from './access.store';
import { GroupsPanel } from './groups-panel';

describe('GroupsPanel Access Simulation (#213)', () => {
  let fixture: ComponentFixture<GroupsPanel>;
  let component: GroupsPanel;
  let adminApi: Partial<AdminApi>;
  let dialogService: Partial<DialogService>;

  const mockGroup: Group = {
    id: 'g-1',
    name: 'Amigos',
    description: 'Grupo dos amigos',
    created_at: '2026-10-24T00:00:00.000Z',
    user_groups: [{ group_id: 'g-1', user_id: 'u-1' }],
    server_groups: [{ group_id: 'g-1', server_id: 's-1' }],
  };

  const mockServers: Partial<ServerSummary>[] = [{ id: 's-1', name: 'Survival' }];

  const mockUsers: Partial<UserSummary>[] = [
    { id: 'u-1', minecraftNick: 'Steve', groupIds: ['g-1'], serverIds: [] },
    { id: 'u-2', minecraftNick: 'Alex', groupIds: [], serverIds: [] },
  ];

  async function setup(options?: { simulateResult?: any[]; confirmResult?: boolean }) {
    adminApi = {
      simulateAccess: vi.fn(() => of(options?.simulateResult ?? [])),
      addUserToGroup: vi.fn(() => of({ success: true })),
      removeUserFromGroup: vi.fn(() => of({ kickedServers: ['s-1'] })),
      addServerToGroup: vi.fn(() => of({ success: true })),
      removeServerFromGroup: vi.fn(() => of({ success: true })),
      deleteGroup: vi.fn(() => of({ success: true })),
      createGroup: vi.fn(),
    };

    dialogService = {
      confirm: vi.fn(async () => options?.confirmResult ?? true),
    };

    const mockStore = {
      groups: {
        value: signal([mockGroup]),
        error: signal(null),
        reload: vi.fn(),
      },
      servers: {
        value: signal(mockServers),
        error: signal(null),
        reload: vi.fn(),
      },
      users: {
        value: signal(mockUsers),
        error: signal(null),
        reload: vi.fn(),
      },
    };

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AccessStore, useValue: mockStore },
        { provide: AdminApi, useValue: adminApi },
        { provide: DialogService, useValue: dialogService },
        {
          provide: ToastService,
          useValue: { success: vi.fn(), error: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupsPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('when simulateAccess returns empty losses, change is applied without calling DialogService.confirm', async () => {
    await setup({
      simulateResult: [
        {
          userId: 'u-2',
          minecraftNick: 'Alex',
          gains: ['s-1'],
          losses: [],
          wouldBeKicked: [],
        },
      ],
    });

    // Simulate adding user u-2 to group g-1
    await (component as any).toggleUser(mockGroup, { id: 'u-2', selected: true });

    expect(adminApi.simulateAccess).toHaveBeenCalledWith([
      { type: 'addUserToGroup', userId: 'u-2', groupId: 'g-1' },
    ]);
    expect(dialogService.confirm).not.toHaveBeenCalled();
    expect(adminApi.addUserToGroup).toHaveBeenCalledWith('g-1', 'u-2');
  });

  it('when simulateAccess returns non-empty losses, DialogService.confirm is called with world names and highlights wouldBeKicked', async () => {
    await setup({
      simulateResult: [
        {
          userId: 'u-1',
          minecraftNick: 'Steve',
          gains: [],
          losses: ['s-1'],
          wouldBeKicked: ['s-1'],
        },
      ],
      confirmResult: true,
    });

    // Simulate removing user u-1 from group g-1
    await (component as any).toggleUser(mockGroup, { id: 'u-1', selected: false });

    expect(adminApi.simulateAccess).toHaveBeenCalledWith([
      { type: 'removeUserFromGroup', userId: 'u-1', groupId: 'g-1' },
    ]);
    expect(dialogService.confirm).toHaveBeenCalledTimes(1);

    const callArgs = (dialogService.confirm as any).mock.calls[0][0];
    expect(callArgs.message).toContain('Survival');
    expect(callArgs.message).toContain('online agora, será expulso');
    expect(callArgs.message).toContain('Steve');

    expect(adminApi.removeUserFromGroup).toHaveBeenCalledWith('g-1', 'u-1');
  });

  it('when simulateAccess returns non-empty losses but user cancels, change is aborted', async () => {
    await setup({
      simulateResult: [
        {
          userId: 'u-1',
          minecraftNick: 'Steve',
          gains: [],
          losses: ['s-1'],
          wouldBeKicked: ['s-1'],
        },
      ],
      confirmResult: false,
    });

    await (component as any).toggleUser(mockGroup, { id: 'u-1', selected: false });

    expect(dialogService.confirm).toHaveBeenCalledTimes(1);
    expect(adminApi.removeUserFromGroup).not.toHaveBeenCalled();
  });

  it('deleteGroup simulates access and previews affected users before confirming deletion', async () => {
    await setup({
      simulateResult: [
        {
          userId: 'u-1',
          minecraftNick: 'Steve',
          gains: [],
          losses: ['s-1'],
          wouldBeKicked: ['s-1'],
        },
      ],
      confirmResult: true,
    });

    await (component as any).remove(mockGroup);

    expect(adminApi.simulateAccess).toHaveBeenCalledWith([{ type: 'deleteGroup', groupId: 'g-1' }]);
    expect(dialogService.confirm).toHaveBeenCalledTimes(1);

    const callArgs = (dialogService.confirm as any).mock.calls[0][0];
    expect(callArgs.message).toContain('Amigos');
    expect(callArgs.message).toContain('Survival');
    expect(callArgs.message).toContain('online agora, será expulso');

    expect(adminApi.deleteGroup).toHaveBeenCalledWith('g-1');
  });
});
