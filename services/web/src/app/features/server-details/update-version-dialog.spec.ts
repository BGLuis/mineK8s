import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MinecraftVersionItem, ServerDetail } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { ServerLifecycle } from '../dashboard/server-lifecycle';
import { ServerDetailStore } from './server-detail.store';
import { McUpdateVersionDialog } from './update-version-dialog';

describe('McUpdateVersionDialog (#203)', () => {
  const mockVersions: MinecraftVersionItem[] = [
    {
      id: '26.4-snapshot-4',
      kind: 'snapshot',
      releaseTime: '2026-09-30T11:32:57+00:00',
    },
    { id: '26.3', kind: 'release', releaseTime: '2026-09-15T11:23:02+00:00' },
    { id: '26.1', kind: 'release', releaseTime: '2026-03-10T12:00:00+00:00' },
    {
      id: '1.21.11',
      kind: 'release',
      releaseTime: '2025-11-15T12:00:00+00:00',
    },
  ];

  const api = {
    updateVersion: vi.fn(),
    listMinecraftVersions: vi.fn().mockReturnValue(of(mockVersions)),
  };

  const store = {
    serverId: signal<string | null>('srv-1'),
    server: signal<ServerDetail | null>({
      id: 'srv-1',
      name: 'Survival',
      subdomain: 'survival',
      game_type: 'minecraft',
      routing_model: 'sni-shared-port',
      server_type: 'VANILLA',
      game_version: '26.3',
      allocated_memory_mb: 4096,
      allocated_port: null,
      state: 'READY',
      access_policy: 'GROUP',
      is_maintenance: false,
      auto_wake: true,
      sleep_timeout_minutes: 15,
      java_version: 25,
      server_build: null,
      server_build_channel: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    }),
    refresh: vi.fn(),
  };

  const mockLifecycle = {
    trackTask: vi.fn(),
  };

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        { provide: ServersApi, useValue: api },
        { provide: ServerDetailStore, useValue: store },
        { provide: ServerLifecycle, useValue: mockLifecycle },
      ],
    });
    const fixture = TestBed.createComponent(McUpdateVersionDialog);
    fixture.componentInstance.open();
    fixture.componentInstance.setVersions(mockVersions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, component: fixture.componentInstance };
  }

  it('shows downgrade warning and disables confirm button until checked (#203)', async () => {
    const { fixture, el, component } = await open();

    // Select older version (1.21.11 is older than 26.3)
    component.setTargetVersion('1.21.11');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Downgrade warning must be visible
    const warning = el.querySelector('[role="alert"]');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain(
      'Voltar para uma versão anterior pode corromper o mundo. Um backup pre-update será criado antes.',
    );

    // Confirm button must be disabled initially
    const confirmButton = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Fazer downgrade'),
    ) as HTMLButtonElement;
    expect(confirmButton).toBeDefined();
    expect(confirmButton.disabled).toBe(true);

    // Check the confirmation checkbox
    const checkbox = el.querySelector('[role="alert"] input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Button becomes enabled
    expect(confirmButton.disabled).toBe(false);

    // Clicking confirm invokes updateVersion with confirm_downgrade: true
    api.updateVersion.mockReturnValue(
      of({
        message: 'Versão atualizada',
        version: '1.21.11',
        rolledBack: false,
      }),
    );
    confirmButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.updateVersion).toHaveBeenCalledWith('srv-1', {
      game_version: '1.21.11',
      confirm_downgrade: true,
    });
  });

  it('shows result dialog with final version and rollback state (#203)', async () => {
    const { fixture, el, component } = await open();

    component.setTargetVersion('26.4-snapshot-4');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Not a downgrade
    expect(el.querySelector('[role="alert"]')).toBeNull();

    const confirmButton = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Atualizar versão'),
    ) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    // Simulate rollback result from API
    api.updateVersion.mockReturnValue(
      of({
        message: 'Rollback executado',
        version: '26.3',
        rolledBack: true,
      }),
    );
    confirmButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Result dialog displays rollback info
    expect(el.textContent).toContain('Rollback executado');
    expect(el.textContent).toContain('26.3');
  });

  it('schedules version update and tracks task via ServerLifecycle when taskId is present (#204)', async () => {
    const { fixture, el, component } = await open();

    component.setTargetVersion('26.4-snapshot-4');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const confirmButton = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Atualizar versão'),
    ) as HTMLButtonElement;

    api.updateVersion.mockReturnValue(
      of({
        message: 'Scheduled',
        version: '26.4-snapshot-4',
        rolledBack: false,
        taskId: 'update-task-1',
      }),
    );
    confirmButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockLifecycle.trackTask).toHaveBeenCalledWith(
      'srv-1',
      'update-task-1',
      'update-version',
    );
  });
});
