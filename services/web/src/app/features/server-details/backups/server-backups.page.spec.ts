import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerDetail } from '../../../core/api/models';
import { BackupsApi } from '../../../core/api/backups.api';
import { ServersApi } from '../../../core/api/servers.api';
import { TasksSocket } from '../../../core/realtime/tasks-socket';
import { ServersSocket } from '../../../core/realtime/servers-socket';
import { AuthSession } from '../../../core/auth/auth-session';
import { ToastService } from '../../../ui';
import { ServerBackupsPage } from './server-backups.page';
import { formatBackupDate } from './backups.model';

describe('ServerBackupsPage (#205)', () => {
  let fixture: ComponentFixture<ServerBackupsPage>;
  let serversApi: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let backupsApi: { list: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const createServerDetail = (overrides?: Partial<ServerDetail>): ServerDetail => ({
    id: 'srv-1',
    name: 'Survival',
    subdomain: 'survival',
    game_type: 'minecraft',
    routing_model: 'sni-shared-port',
    server_type: 'PAPER',
    game_version: '1.20.4',
    allocated_memory_mb: 4096,
    allocated_port: null,
    state: 'STOPPED',
    access_policy: 'GROUP',
    is_maintenance: false,
    auto_wake: true,
    sleep_timeout_minutes: 15,
    stop_warning_minutes: 10,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
    java_version: 21,
    server_build: '1',
    server_build_channel: 'STABLE',
    backup_schedule_mode: 'OFF',
    backup_interval_hours: 12,
    backup_daily_time: '04:00',
    backup_window_start: null,
    backup_window_end: null,
    backup_timezone: 'America/Sao_Paulo',
    backup_retention_count: 5,
    backup_next_run_at: null,
    ...overrides,
  });

  const initialServer = createServerDetail();
  const updatedServer = createServerDetail({
    backup_schedule_mode: 'DAILY',
    backup_daily_time: '04:00',
    backup_next_run_at: '2026-10-19T07:00:00.000Z',
  });

  beforeEach(async () => {
    serversApi = {
      get: vi.fn(() => of(initialServer)),
      update: vi.fn(() => of(updatedServer)),
    };

    backupsApi = {
      list: vi.fn(() => of([])),
    };

    toast = {
      success: vi.fn(),
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ServerBackupsPage],
      providers: [
        { provide: ServersApi, useValue: serversApi },
        { provide: BackupsApi, useValue: backupsApi },
        { provide: ToastService, useValue: toast },
        {
          provide: TasksSocket,
          useValue: { progress: () => EMPTY },
        },
        {
          provide: ServersSocket,
          useValue: { signals: () => EMPTY },
        },
        {
          provide: AuthSession,
          useValue: { isAdmin: () => true },
        },
      ],
    });

    fixture = TestBed.createComponent(ServerBackupsPage);
    fixture.componentRef.setInput('id', 'srv-1');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('o bloco "Agendamento" salva o modo DAILY e mostra o próximo horário (#205)', async () => {
    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('[data-testid="backup-schedule-panel"]');
    expect(panel).not.toBeNull();

    // Próximo horário inicial é "Nenhum agendamento ativo"
    const nextRunEl = el.querySelector('[data-testid="next-run-at"]');
    expect(nextRunEl?.textContent?.trim()).toBe('Nenhum agendamento ativo');

    // Troca para o modo DAILY
    const select = panel?.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = 'DAILY';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Localiza e clica no botão "Salvar agendamento"
    const saveBtn = Array.from(panel?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Salvar agendamento'),
    );
    expect(saveBtn).toBeDefined();
    saveBtn?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // Verifica que o update foi chamado com o modo DAILY e os parâmetros correspondentes
    expect(serversApi.update).toHaveBeenCalledWith(
      'srv-1',
      expect.objectContaining({
        backup_schedule_mode: 'DAILY',
        backup_daily_time: '04:00',
      }),
    );

    // Verifica que o toast de sucesso foi disparado
    expect(toast.success).toHaveBeenCalledWith('Agendamento de backups salvo.');

    // Verifica que o próximo horário calculado é exibido no bloco
    const expectedNextRun = formatBackupDate('2026-10-19T07:00:00.000Z');
    expect(nextRunEl?.textContent?.trim()).toBe(expectedNextRun);
  });
});
