import { TestBed } from '@angular/core/testing';

import { McPlayerHead, playerHeadUrl } from './player-head';

describe('playerHeadUrl', () => {
  it('asks mc-heads.net for the head by nick', () => {
    expect(playerHeadUrl('Luiishgb')).toBe('https://mc-heads.net/avatar/Luiishgb/80');
  });

  it('encodes the nick so it cannot change the path', () => {
    expect(playerHeadUrl('a/b?c')).toBe('https://mc-heads.net/avatar/a%2Fb%3Fc/80');
  });
});

describe('McPlayerHead', () => {
  async function render(nick: string) {
    const fixture = TestBed.createComponent(McPlayerHead);
    fixture.componentRef.setInput('nick', nick);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the head image', async () => {
    const fixture = await render('Luiishgb');
    const img = (fixture.nativeElement as HTMLElement).querySelector('img');

    expect(img?.getAttribute('src')).toBe('https://mc-heads.net/avatar/Luiishgb/80');
  });

  it('falls back to the initial of the nick when the image fails to load', async () => {
    const fixture = await render('luiishgb');
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent?.trim()).toBe('L');
  });

  it('tries the image again for another nick after a failure', async () => {
    const fixture = await render('Steve');
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    fixture.componentRef.setInput('nick', 'Alex');
    await fixture.whenStable();

    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'https://mc-heads.net/avatar/Alex/80',
    );
  });
});
