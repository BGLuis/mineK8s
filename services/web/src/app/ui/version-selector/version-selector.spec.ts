import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { MinecraftVersionItem } from '../../core/api/models';
import { ServersApi } from '../../core/api/servers.api';
import { McVersionSelector } from './version-selector';

@Component({
  imports: [McVersionSelector],
  template: `
    <mc-version-selector
      label="Versão do Minecraft"
      [serverType]="serverType()"
      [versions]="versions()"
      [(value)]="selected"
    />
  `,
})
class TestHost {
  readonly serverType = signal('VANILLA');
  readonly versions = signal<MinecraftVersionItem[] | null>(null);
  readonly selected = signal('1.21.1');
}

describe('McVersionSelector', () => {
  const mockApiVersions: MinecraftVersionItem[] = [
    { id: '26.4-snapshot-4', kind: 'snapshot' },
    { id: '26.3', kind: 'release' },
    { id: '1.21.1', kind: 'release' },
    { id: '1.20.4', kind: 'release' },
  ];

  let fixture: ComponentFixture<TestHost>;
  let listCalls: { type: string; snapshots: boolean }[] = [];

  const setup = async (versionsOverride: MinecraftVersionItem[] | null = null) => {
    listCalls = [];
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: ServersApi,
          useValue: {
            listMinecraftVersions: (type: string, snapshots = false) => {
              listCalls.push({ type, snapshots });
              const result = snapshots
                ? mockApiVersions
                : mockApiVersions.filter((v) => v.kind === 'release');
              return of(result);
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    if (versionsOverride !== null) {
      fixture.componentInstance.versions.set(versionsOverride);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('lists versions of chosen type and hides snapshots by default (#202)', async () => {
    await setup();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    const optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);

    expect(optionValues).toContain('26.3');
    expect(optionValues).toContain('1.21.1');
    expect(optionValues).toContain('1.20.4');
    expect(optionValues).not.toContain('26.4-snapshot-4');
  });

  it('shows snapshots when the checkbox is checked (#202)', async () => {
    await setup();

    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    const optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);

    expect(optionValues).toContain('26.4-snapshot-4');
    expect(optionValues).toContain('26.3');
  });

  it('filters versions using search input', async () => {
    await setup();

    const searchInput = fixture.nativeElement.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    searchInput.value = '1.20';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    const optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);

    expect(optionValues).toEqual(['1.20.4']);
  });

  it('updates model when a version is selected', async () => {
    await setup();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = '26.3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.selected()).toBe('26.3');
  });
});
