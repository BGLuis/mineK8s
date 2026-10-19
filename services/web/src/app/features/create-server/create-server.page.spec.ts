import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { MinecraftVersionItem } from '../../core/api/models';
import { ModpacksApi } from '../../core/api/modpacks.api';
import { ServersApi } from '../../core/api/servers.api';
import { TasksSocket } from '../../core/realtime/tasks-socket';
import { ToastService } from '../../ui';
import { CreateServerPage } from './create-server.page';

describe('CreateServerPage - Version Selection (#202)', () => {
  let fixture: ComponentFixture<CreateServerPage>;

  const mockVersions: MinecraftVersionItem[] = [
    { id: '26.4-snapshot-4', kind: 'snapshot' },
    { id: '26.3', kind: 'release' },
    { id: '1.21.1', kind: 'release' },
    { id: '1.20.4', kind: 'release' },
  ];

  const setup = async () => {
    await TestBed.configureTestingModule({
      imports: [CreateServerPage],
      providers: [
        provideRouter([]),
        {
          provide: ServersApi,
          useValue: {
            listMinecraftVersions: (_type: string, snapshots = false) => {
              const result = snapshots
                ? mockVersions
                : mockVersions.filter((v) => v.kind === 'release');
              return of(result);
            },
          },
        },
        {
          provide: ModpacksApi,
          useValue: {
            search: () => of({ hits: [], total: 0 }),
            versions: () => of([]),
          },
        },
        {
          provide: TasksSocket,
          useValue: {
            watch: () => of(),
          },
        },
        {
          provide: ToastService,
          useValue: {
            show: () => {},
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateServerPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('lists versions of chosen type and hides snapshots until checked (#202)', async () => {
    await setup();

    // Select profile 'VANILLA'
    const vanillaRadio = fixture.nativeElement.querySelector(
      'input[value="VANILLA"]',
    ) as HTMLInputElement;
    vanillaRadio.checked = true;
    vanillaRadio.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const versionSelector = fixture.nativeElement.querySelector('mc-version-selector');
    expect(versionSelector).not.toBeNull();

    const select = versionSelector.querySelector('select') as HTMLSelectElement;
    let optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);

    // Initial state: only releases, no snapshots
    expect(optionValues).toContain('26.3');
    expect(optionValues).toContain('1.21.1');
    expect(optionValues).toContain('1.20.4');
    expect(optionValues).not.toContain('26.4-snapshot-4');

    // Toggle snapshot checkbox
    const checkbox = versionSelector.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(optionValues).toContain('26.4-snapshot-4');
    expect(optionValues).toContain('26.3');
  });
});
