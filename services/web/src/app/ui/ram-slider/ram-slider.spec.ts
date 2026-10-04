import { TestBed } from '@angular/core/testing';

import { McRamSlider, RAM_MAX_MB, RAM_MIN_MB, containerMemoryMb, formatGib } from './ram-slider';

describe('container memory math (C-17)', () => {
  it('adds a fixed 1536 MB overhead on top of the heap', () => {
    expect(containerMemoryMb(4096)).toBe(5632);
    expect(containerMemoryMb(RAM_MIN_MB)).toBe(2560);
    expect(containerMemoryMb(RAM_MAX_MB)).toBe(67072);
  });

  it('formats GiB with one decimal and a pt-BR comma', () => {
    expect(formatGib(4096)).toBe('4,0 GiB');
    expect(formatGib(1536)).toBe('1,5 GiB');
    expect(formatGib(5632)).toBe('5,5 GiB');
  });
});

describe('McRamSlider', () => {
  it('spans 1024-65536 MB and shows "heap + 1,5 GiB = container"', async () => {
    const fixture = TestBed.createComponent(McRamSlider);
    fixture.componentInstance.writeValue(6144);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const range = el.querySelector('input[type=range]') as HTMLInputElement;

    expect(range.min).toBe('1024');
    expect(range.max).toBe('65536');
    expect(el.textContent).toContain('6,0 GiB heap + 1,5 GiB de margem = 7,5 GiB');
  });

  it('writes the chosen heap back to the form control', async () => {
    const fixture = TestBed.createComponent(McRamSlider);
    const onChange = vi.fn();
    fixture.componentInstance.registerOnChange(onChange);
    await fixture.whenStable();
    const range = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type=range]',
    ) as HTMLInputElement;

    range.value = '8192';
    range.dispatchEvent(new Event('input'));

    expect(onChange).toHaveBeenCalledWith(8192);
  });

  it('clamps values written from outside the allowed range', async () => {
    const fixture = TestBed.createComponent(McRamSlider);
    fixture.componentInstance.writeValue(512);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1,0 GiB heap');
  });
});
