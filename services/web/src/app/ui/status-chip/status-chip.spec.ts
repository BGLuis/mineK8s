import { TestBed } from '@angular/core/testing';

import { ServerState } from '../../core/api/models';
import { McStatusChip, StatusChipState } from './status-chip';

interface Expected {
  label: string;
  tone: string;
  colorClass: string;
  blinks: boolean;
}

const EXPECTED: Record<StatusChipState, Expected> = {
  PROVISIONING: {
    label: 'PROVISIONANDO',
    tone: 'info',
    colorClass: 'text-status-info',
    blinks: false,
  },
  STARTING: {
    label: 'INICIANDO',
    tone: 'warning',
    colorClass: 'text-status-warning',
    blinks: true,
  },
  READY: { label: 'ONLINE', tone: 'success', colorClass: 'text-status-success', blinks: false },
  STOPPING: { label: 'PARANDO', tone: 'warning', colorClass: 'text-status-warning', blinks: true },
  STOPPED: {
    label: 'HIBERNANDO',
    tone: 'neutral',
    colorClass: 'text-status-neutral',
    blinks: false,
  },
  UPDATING: { label: 'ATUALIZANDO', tone: 'info', colorClass: 'text-status-info', blinks: true },
  CRASHED: { label: 'TRAVOU', tone: 'danger', colorClass: 'text-status-danger', blinks: false },
  FAILED: { label: 'FALHOU', tone: 'danger', colorClass: 'text-status-danger', blinks: false },
  MAINTENANCE: {
    label: 'MANUTENÇÃO',
    tone: 'accent',
    colorClass: 'text-status-accent',
    blinks: false,
  },
};

describe('McStatusChip', () => {
  async function render(state: StatusChipState): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(McStatusChip);
    fixture.componentRef.setInput('state', state);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('covers every server state plus maintenance', () => {
    const backendStates: ServerState[] = [
      'PROVISIONING',
      'STARTING',
      'READY',
      'STOPPING',
      'STOPPED',
      'UPDATING',
      'CRASHED',
      'FAILED',
    ];
    expect(Object.keys(EXPECTED).sort()).toEqual([...backendStates, 'MAINTENANCE'].sort());
  });

  for (const [state, expected] of Object.entries(EXPECTED) as [StatusChipState, Expected][]) {
    it(`renders ${state} as "${expected.label}" with the ${expected.tone} colour`, async () => {
      const el = await render(state);
      const chip = el.querySelector('[data-tone]') as HTMLElement;

      expect(chip.textContent?.trim()).toBe(expected.label);
      expect(chip.dataset['tone']).toBe(expected.tone);
      expect(chip.classList).toContain(expected.colorClass);
      expect(el.querySelector('.blink') !== null).toBe(expected.blinks);
    });
  }
});
