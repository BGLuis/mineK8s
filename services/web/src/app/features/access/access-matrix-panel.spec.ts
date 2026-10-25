import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessMatrixResponse, AdminApi, Group } from '../../core/api';
import { AccessMatrixPanel } from './access-matrix-panel';
import { AccessStore } from './access.store';

describe('AccessMatrixPanel (#214)', () => {
  let fixture: ComponentFixture<AccessMatrixPanel>;
  let component: AccessMatrixPanel;
  let adminApi: Partial<AdminApi>;

  const mockGroups: Partial<Group>[] = [
    { id: 'g-1', name: 'Membros' },
    { id: 'g-2', name: 'Construtores' },
  ];

  const mockMatrix: AccessMatrixResponse = {
    users: [
      {
        id: 'u-admin',
        minecraftNick: 'AdminBoss',
        realName: 'Master Admin',
        role: 'ADMIN',
        groupIds: [],
      },
      {
        id: 'u-1',
        minecraftNick: 'Steve',
        realName: 'Steve Player',
        role: 'PLAYER',
        groupIds: ['g-1'],
      },
      {
        id: 'u-2',
        minecraftNick: 'Alex',
        realName: 'Alex Player',
        role: 'PLAYER',
        groupIds: ['g-2'],
      },
    ],
    servers: [
      {
        id: 's-1',
        name: 'Survival',
        subdomain: 'survival',
        state: 'READY',
        access_policy: 'GROUP',
        is_maintenance: false,
      },
      {
        id: 's-2',
        name: 'Criativo',
        subdomain: 'criativo',
        state: 'READY',
        access_policy: 'INDIVIDUAL',
        is_maintenance: false,
      },
    ],
    cells: {
      'u-admin': {
        's-1': { allowed: true, reason: 'ADMIN', grantedBy: { kind: 'ADMIN' } },
        's-2': { allowed: true, reason: 'ADMIN', grantedBy: { kind: 'ADMIN' } },
      },
      'u-1': {
        's-1': {
          allowed: true,
          reason: 'GROUP',
          grantedBy: { kind: 'GROUP', groupIds: ['g-1'], groupNames: ['Membros'] },
        },
        's-2': {
          allowed: false,
          reason: 'INDIVIDUAL_ACCESS_DENIED',
          grantedBy: null,
        },
      },
      'u-2': {
        's-1': {
          allowed: false,
          reason: 'INSUFFICIENT_GROUPS',
          grantedBy: null,
        },
        's-2': {
          allowed: true,
          reason: 'DIRECT',
          grantedBy: { kind: 'DIRECT' },
        },
      },
    },
  };

  async function setup() {
    adminApi = {
      getAccessMatrix: vi.fn(() => of(mockMatrix)),
    };

    const mockStore = {
      groups: {
        value: signal(mockGroups as Group[]),
        error: signal(null),
        reload: vi.fn(),
      },
    };

    await TestBed.configureTestingModule({
      imports: [AccessMatrixPanel],
      providers: [
        provideRouter([]),
        { provide: AdminApi, useValue: adminApi },
        { provide: AccessStore, useValue: mockStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccessMatrixPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('displays ADMIN users in separate summary row as "Acesso a todos os mundos" and excludes them from player rows', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;

    // Admin summary bar
    const summaryRegion = el.querySelector('[aria-label="Administradores com acesso irrestrito"]');
    expect(summaryRegion).not.toBeNull();
    expect(summaryRegion?.textContent).toContain('Acesso a todos os mundos');
    expect(summaryRegion?.textContent).toContain('AdminBoss');

    const adminLink = summaryRegion?.querySelector('a');
    expect(adminLink?.getAttribute('href')).toBe('/access/users/u-admin');

    // Player rows in table
    const tableRows = el.querySelectorAll('tbody tr');
    expect(tableRows.length).toBe(2);

    const firstPlayerCell = tableRows[0].querySelector('td a');
    expect(firstPlayerCell?.textContent?.trim()).toBe('Steve');
    expect(firstPlayerCell?.getAttribute('href')).toBe('/access/users/u-1');

    const secondPlayerCell = tableRows[1].querySelector('td a');
    expect(secondPlayerCell?.textContent?.trim()).toBe('Alex');
    expect(secondPlayerCell?.getAttribute('href')).toBe('/access/users/u-2');
  });

  it('presents the Portuguese reason in the accessible name and title of each cell', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const tableRows = el.querySelectorAll('tbody tr');

    // Steve on Survival (cell allowed by group "Membros")
    const steveSurvivalCell = tableRows[0].querySelectorAll('td')[1];
    const steveSurvivalSpan = steveSurvivalCell.querySelector('span[aria-label]');
    expect(steveSurvivalSpan).not.toBeNull();
    expect(steveSurvivalSpan?.getAttribute('aria-label')).toContain('Pelo grupo Membros');
    expect(steveSurvivalSpan?.getAttribute('title')).toBe('Pelo grupo Membros');
    expect(steveSurvivalCell.textContent).toContain('Pelo grupo Membros');

    // Steve on Criativo (cell denied by INDIVIDUAL_ACCESS_DENIED)
    const steveCriativoCell = tableRows[0].querySelectorAll('td')[2];
    const steveCriativoSpan = steveCriativoCell.querySelector('span[aria-label]');
    expect(steveCriativoSpan).not.toBeNull();
    expect(steveCriativoSpan?.getAttribute('aria-label')).toContain(
      'Sem acesso direto a este mundo',
    );
    expect(steveCriativoSpan?.getAttribute('title')).toBe('Sem acesso direto a este mundo');
    expect(steveCriativoCell.textContent).toContain('Sem acesso direto a este mundo');

    // Alex on Criativo (cell allowed by DIRECT)
    const alexCriativoCell = tableRows[1].querySelectorAll('td')[2];
    const alexCriativoSpan = alexCriativoCell.querySelector('span[aria-label]');
    expect(alexCriativoSpan).not.toBeNull();
    expect(alexCriativoSpan?.getAttribute('aria-label')).toContain('Acesso direto');
    expect(alexCriativoSpan?.getAttribute('title')).toBe('Acesso direto');
    expect(alexCriativoCell.textContent).toContain('Acesso direto');
  });

  it('filters table by group', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;

    // Filter by group g-1 ("Membros")
    component.selectedGroupId.set('g-1');
    fixture.detectChanges();

    let rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('td a')?.textContent?.trim()).toBe('Steve');

    // Filter by group g-2 ("Construtores")
    component.selectedGroupId.set('g-2');
    fixture.detectChanges();

    rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('td a')?.textContent?.trim()).toBe('Alex');

    // Filter by unknown group
    component.selectedGroupId.set('non-existent');
    fixture.detectChanges();

    rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Nenhum jogador encontrado');
  });

  it('filters table by world', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;

    // Initially 2 servers
    let headers = el.querySelectorAll('thead th');
    expect(headers.length).toBe(3); // Jogador + Survival + Criativo

    // Filter by world s-1 ("Survival")
    component.selectedServerId.set('s-1');
    fixture.detectChanges();

    headers = el.querySelectorAll('thead th');
    expect(headers.length).toBe(2); // Jogador + Survival
    expect(headers[1].textContent).toContain('Survival');
    expect(headers[1].textContent).not.toContain('Criativo');

    const firstRowCells = el.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(firstRowCells.length).toBe(2); // Jogador + Survival cell
  });
});
