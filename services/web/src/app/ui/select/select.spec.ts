import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { McSelect, SelectOption } from './select';

@Component({
  imports: [McSelect],
  template: `
    <mc-select
      label="Versão"
      [options]="opts"
      [(value)]="selected"
      [disabled]="disabled()"
    />
  `,
})
class TestHost {
  readonly opts: SelectOption[] = [
    { value: '1.20.1', label: '1.20.1' },
    { value: '1.21.1', label: '1.21.1' },
  ];
  readonly selected = signal('1.20.1');
  readonly disabled = signal(false);
}

describe('McSelect', () => {
  let fixture: ComponentFixture<TestHost>;

  it('renders options and updates model on change', () => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select');
    expect(select.value).toBe('1.20.1');

    select.value = '1.21.1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.selected()).toBe('1.21.1');
  });
});
