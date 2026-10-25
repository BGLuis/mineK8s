import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { LagSnapshot } from '../../../core/api/models';
import { ServersApi } from '../../../core/api/servers.api';
import { McLagAnalysis } from './lag-analysis';

const snapshot: LagSnapshot = {
  takenAt: '2026-10-25T17:00:00Z',
  radius: 64,
  dimensions: [
    {
      id: 'minecraft:overworld',
      players: ['Farmer'],
      entities: 950,
      items: 40,
      meanTickMs: null,
      topEntities: [],
    },
  ],
  players: [
    {
      nick: 'Farmer',
      dimension: 'minecraft:overworld',
      position: { x: 100.5, y: 64, z: -200.5 },
      nearbyEntities: 800,
      nearbyItems: 12,
    },
  ],
  findings: [{ severity: 'warning', message: 'Farmer está perto de 800 entidades.' }],
};

async function setup(lagSnapshot: (id: string) => Observable<LagSnapshot>) {
  const requested: string[] = [];
  await TestBed.configureTestingModule({
    imports: [McLagAnalysis],
    providers: [
      {
        provide: ServersApi,
        useValue: {
          lagSnapshot: (id: string) => {
            requested.push(id);
            return lagSnapshot(id);
          },
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(McLagAnalysis);
  fixture.componentRef.setInput('serverId', 'srv-1');
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;

  const analyze = async () => {
    element.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { element, analyze, requested };
}

describe('McLagAnalysis', () => {
  it('takes no snapshot until asked, since it costs dozens of RCON commands', async () => {
    const { element, requested } = await setup(() => of(snapshot));

    expect(requested).toEqual([]);
    expect(element.querySelector('table')).toBeNull();
  });

  it('shows the findings and who is next to what', async () => {
    const { element, analyze, requested } = await setup(() => of(snapshot));

    await analyze();

    expect(requested).toEqual(['srv-1']);
    expect(element.textContent).toContain('Possível causa');
    expect(element.textContent).toContain('Farmer está perto de 800 entidades.');
    const playerRow = element.querySelectorAll('table')[1].querySelector('tbody tr');
    expect(playerRow?.textContent).toContain('101, 64, -200');
    expect(playerRow?.textContent).toContain('800');
  });

  it('only shows the tick time column when the server times its dimensions', async () => {
    const { element, analyze } = await setup(() => of(snapshot));
    await analyze();
    expect(element.textContent).not.toContain('Tick médio');
  });

  it('says nothing stood out when there are no warnings', async () => {
    const { element, analyze } = await setup(() => of({ ...snapshot, findings: [] }));

    await analyze();

    expect(element.textContent).toContain('Nada fora do normal');
  });

  it('explains why the snapshot failed', async () => {
    const { element, analyze } = await setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'The server must be READY to take a lag snapshot' },
          }),
      ),
    );

    await analyze();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível analisar o lag',
    );
  });
});
