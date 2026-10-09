import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { McSwitch } from './switch';

@Component({
  imports: [McSwitch],
  template: `
    <mc-switch [label]="'Auto Wake'" [(checked)]="val" [disabled]="dis()">
      Inicia automaticamente ao receber conexões.
    </mc-switch>
  `,
})
class TestHost {
  readonly val = signal(false);
  readonly dis = signal(false);
}

describe('McSwitch', () => {
  let fixture: ComponentFixture<TestHost>;

  it('toggles value when clicked and respects disabled', async () => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button[role="switch"]');
    expect(button.getAttribute('aria-checked')).toBe('false');

    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.val()).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');

    fixture.componentInstance.dis.set(true);
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.val()).toBe(true);
  });
});
