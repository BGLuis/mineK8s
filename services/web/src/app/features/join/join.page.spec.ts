import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { JoinPage } from './join.page';

const invite = {
  id: 'i1',
  token: 'tok'.repeat(6),
  name: 'Amigos da escola',
  maxUses: 5,
  usedCount: 2,
  expiresAt: new Date(2026, 9, 9, 12).toISOString(),
  status: 'Active',
  joinUrl: '',
  groupIds: [],
  serverIds: ['a', 'b'],
  createdAt: '',
};

const claimResult = {
  userId: 'u1',
  realName: 'Bia <b>Souza</b>',
  minecraftNick: 'bia_mc',
  authKey: 'tskey-auth-k8FqAbCdEfGhIjKl92xZ',
  deepLinkUrl: 'tailscale://login?key=abc',
  tailcatTunnel: { serverAddress: 'survival.mine.internal', instructions: 'conecte' },
  expiresAt: new Date(2026, 9, 3, 14, 5).toISOString(),
};

describe('JoinPage', () => {
  let http: HttpTestingController;

  async function setup(token: string | undefined) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(JoinPage);
    fixture.componentRef.setInput('token', token);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, label: string, value: string) {
    const field = [...el.querySelectorAll('mc-text-field')].find((node) =>
      node.querySelector('label')?.textContent?.includes(label),
    )!;
    const input = field.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  const submit = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

  afterEach(() => http.verify());

  it('shows a friendly card without calling the API when the link has no token', async () => {
    const { el } = await setup(undefined);

    http.expectNone(() => true);
    expect(el.querySelector('h1')?.textContent).toContain('Faltou o convite');
  });

  it('shows why an expired invite cannot be used', async () => {
    const { fixture, el } = await setup('tok');

    http
      .expectOne('/api/tailscale/invites/validate/tok')
      .flush(
        { code: 'INVITE_EXPIRED', message: 'This invite has expired' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('Este convite expirou');
    expect(el.querySelector('form')).toBeNull();
  });

  it('shows a warning instead of the form when key invites are turned off', async () => {
    const { fixture, el } = await setup('tok');

    http.expectOne('/api/tailscale/invites/validate/tok').flush(
      {
        code: 'INVITE_KEY_DISABLED',
        message: 'Os convites com chave de acesso estão desativados.',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('Convites por chave estão desativados');
    expect(el.querySelector('mc-banner')?.textContent).toContain('Convite indisponível');
    expect(el.textContent).toContain('liberar seu acesso pelo Tailscale');
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });

  it('shows the invite details and the remaining uses', async () => {
    const { fixture, el } = await setup('tok');

    http.expectOne('/api/tailscale/invites/validate/tok').flush(invite);
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('Você foi convidado!');
    expect(el.textContent).toContain('Amigos da escola');
    expect(el.textContent).toContain('Acesso a 2 servidores · 3 usos restantes · expira em 09/10');
  });

  it('shows markup in the invite name as text, never as elements (#94)', async () => {
    const { fixture, el } = await setup('tok');

    http
      .expectOne('/api/tailscale/invites/validate/tok')
      .flush({ ...invite, name: '<script>alert(1)</script><img src=x onerror=alert(2)>' });
    await fixture.whenStable();

    expect(el.textContent).toContain('<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(el.querySelector('script, img')).toBeNull();
  });

  it('names the servers and who invited when the backend provides them', async () => {
    const { fixture, el } = await setup('tok');

    http
      .expectOne('/api/tailscale/invites/validate/tok')
      .flush({ ...invite, serverNames: ['Survival', 'Creative'], createdBy: 'AdminSteve' });
    await fixture.whenStable();

    expect(el.textContent).toContain('AdminSteve chamou você para jogar em Survival e Creative.');
  });

  it('keeps the generic wording for older invites without names', async () => {
    const { fixture, el } = await setup('tok');

    http.expectOne('/api/tailscale/invites/validate/tok').flush(invite);
    await fixture.whenStable();

    expect(el.textContent).toContain(
      'Um administrador chamou você para jogar nos servidores dele.',
    );
  });

  it('does not claim with a 2 character nick', async () => {
    const { fixture, el } = await setup('tok');
    http.expectOne('/api/tailscale/invites/validate/tok').flush(invite);
    await fixture.whenStable();

    type(el, 'Seu nome', 'Bia Souza');
    type(el, 'Seu nick', 'bi');
    submit(el);
    await fixture.whenStable();

    http.expectNone('/api/tailscale/claim');
    expect(el.textContent).toContain('Use 3 a 16 letras, números ou _');
  });

  it('claims with trimmed values and renders the success steps as plain text', async () => {
    const { fixture, el } = await setup('tok');
    http.expectOne('/api/tailscale/invites/validate/tok').flush(invite);
    await fixture.whenStable();

    type(el, 'Seu nome', ' Bia Souza ');
    type(el, 'Seu nick', ' bia_mc ');
    submit(el);

    const req = http.expectOne('/api/tailscale/claim');
    expect(req.request.body).toEqual({
      token: 'tok',
      realName: 'Bia Souza',
      minecraftNick: 'bia_mc',
    });
    req.flush(claimResult);
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('Tudo pronto, Bia');
    expect(el.textContent).toContain('tskey-auth-k8Fq…92xZ');
    expect(el.textContent).not.toContain('AbCdEf');
    expect(el.textContent).toContain('survival.mine.internal');
    expect(el.textContent).toContain('A chave vale até 03/10 às 14:05');
    expect(el.querySelector('h1 b')).toBeNull();
  });

  it('keeps the form and shows the reason when the claim is refused', async () => {
    const { fixture, el } = await setup('tok');
    http.expectOne('/api/tailscale/invites/validate/tok').flush(invite);
    await fixture.whenStable();

    type(el, 'Seu nome', 'Bia Souza');
    type(el, 'Seu nick', 'bia_mc');
    submit(el);
    http
      .expectOne('/api/tailscale/claim')
      .flush({ message: 'Nickname já está em uso' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(el.querySelector('form')).not.toBeNull();
    expect(el.textContent).toContain('Nickname já está em uso');
  });
});
