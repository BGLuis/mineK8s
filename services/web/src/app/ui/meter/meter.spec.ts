import { TestBed } from '@angular/core/testing';

import { McMeter, meterFilledBlocks, meterLevel } from './meter';

describe('meterLevel', () => {
  it.each([
    [0, 'success'],
    [74, 'success'],
    [75, 'warning'],
    [89, 'warning'],
    [90, 'danger'],
    [100, 'danger'],
  ])('%i %% is %s', (percent, level) => {
    expect(meterLevel(percent)).toBe(level);
  });

  it('treats the boundaries as inclusive on the upper level', () => {
    expect(meterLevel(74.99)).toBe('success');
    expect(meterLevel(89.99)).toBe('warning');
  });
});

describe('meterFilledBlocks', () => {
  it('maps percent to 10 blocks and clamps out-of-range values', () => {
    expect(meterFilledBlocks(42)).toBe(4);
    expect(meterFilledBlocks(100)).toBe(10);
    expect(meterFilledBlocks(-5)).toBe(0);
    expect(meterFilledBlocks(250)).toBe(10);
  });
});

describe('McMeter', () => {
  async function render(value: number): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(McMeter);
    fixture.componentRef.setInput('label', 'CPU');
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('always shows the label and the numeric value, and exposes the level', async () => {
    const el = await render(75);

    expect(el.textContent).toContain('CPU');
    expect(el.textContent).toContain('75 %');
    expect(el.querySelector('[role=meter]')?.getAttribute('data-level')).toBe('warning');
    expect(el.querySelector('[role=meter]')?.getAttribute('aria-valuenow')).toBe('75');
  });

  it('colours only the filled blocks with the level colour', async () => {
    const el = await render(90);
    const blocks = Array.from(el.querySelectorAll('[role=meter] > span'));

    expect(blocks).toHaveLength(10);
    expect(blocks.filter((b) => b.classList.contains('bg-status-danger'))).toHaveLength(9);
    expect(blocks.filter((b) => b.classList.contains('bg-bg-sunken'))).toHaveLength(1);
  });
});
