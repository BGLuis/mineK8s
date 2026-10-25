import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { LoginPage } from './login.page';

const admin = {
  id: 'u1',
  minecraft_nick: 'luis_dev',
  role: 'ADMIN',
  real_name: null,
  email: null,
  tailscale_user_id: null,
  created_at: '',
  updated_at: '',
};

describe('LoginPage', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;

  async function setup(redirect?: string, initialToken?: string) {
    sessionStorage.clear();
    if (initialToken) {
      sessionStorage.setItem('mc.access_token', initialToken);
    }
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => redirect ?? null } } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
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

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('button')].find((node) => node.textContent?.includes(text))!;

  afterEach(() => http.verify());

  it('signs in through the VPN identity with no body and returns to the page the user wanted', async () => {
    const { fixture, el } = await setup('/access');

    button(el, 'Entrar como admin').click();
    const req = http.expectOne('/api/auth/session');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ access_token: 'jwt', user: admin });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/access');
    expect(sessionStorage.getItem('mc.access_token')).toBe('jwt');
  });

  it('never sends a nickname to sign in: the identity comes from the network', async () => {
    const { el } = await setup();
    type(el, 'Seu nick', 'luis_dev');

    button(el, 'Entrar como admin').click();

    expect(JSON.stringify(http.expectOne('/api/auth/session').request.body)).not.toContain(
      'luis_dev',
    );
    http.expectNone('/api/auth/token');
  });

  it('no longer flags the VPN login as mocked', async () => {
    const { el } = await setup();

    expect(el.querySelector('mc-no-api-tag')).toBeNull();
  });

  it('ignores a redirect that points outside the app', async () => {
    const { fixture, el } = await setup('https://evil.example');

    button(el, 'Entrar como admin').click();
    http.expectOne('/api/auth/session').flush({ access_token: 'jwt', user: admin });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('signs in as PLAYER via VPN, keeps the session, and navigates to /meus-mundos (#216)', async () => {
    const { fixture, el } = await setup();

    button(el, 'Entrar como admin').click();
    http
      .expectOne('/api/auth/session')
      .flush({ access_token: 'jwt', user: { ...admin, role: 'PLAYER' } });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/meus-mundos');
    expect(sessionStorage.getItem('mc.access_token')).toBe('jwt');
  });

  it('navigates to /meus-mundos on init if restored user is a PLAYER (#216)', async () => {
    const { fixture } = await setup(undefined, 'saved-jwt');
    http.expectOne('/api/auth/me').flush({ ...admin, role: 'PLAYER' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/meus-mundos');
  });

  it('explains when the VPN does not identify the visitor', async () => {
    const { fixture, el } = await setup();

    button(el, 'Entrar como admin').click();
    http.expectOne('/api/auth/session').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(el.textContent).toContain('Não identificamos você pela VPN');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says Tailscale could not be reached when the control plane cannot ask it', async () => {
    const { fixture, el } = await setup();

    button(el, 'Entrar como admin').click();
    http
      .expectOne('/api/auth/session')
      .flush(
        { message: 'Tailscale identity lookup is unavailable' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await fixture.whenStable();

    expect(el.textContent).toContain('não conseguiu consultar o Tailscale');
    expect(el.textContent).not.toContain('identity lookup');
  });

  it('does not send the bootstrap request when the nick has 2 characters', async () => {
    const { fixture, el } = await setup();

    type(el, 'Token de instalação', 'abc-123');
    type(el, 'Seu nick', 'ab');
    button(el, 'Criar primeiro administrador').click();
    await fixture.whenStable();

    http.expectNone('/api/auth/bootstrap');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('3 a 16');
  });

  it('bootstraps the first admin with a valid nick and goes to the dashboard', async () => {
    const { fixture, el } = await setup();

    type(el, 'Token de instalação', ' abc-123 ');
    type(el, 'Seu nick', 'Steve_99');
    button(el, 'Criar primeiro administrador').click();

    const req = http.expectOne('/api/auth/bootstrap');
    expect(req.request.body).toEqual({ bootstrap_token: 'abc-123', minecraft_nick: 'Steve_99' });
    req.flush({ access_token: 'jwt', user: admin, message: 'ok' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows the backend reason when the bootstrap token is wrong', async () => {
    const { fixture, el } = await setup();

    type(el, 'Token de instalação', 'wrong');
    type(el, 'Seu nick', 'Steve_99');
    button(el, 'Criar primeiro administrador').click();
    http
      .expectOne('/api/auth/bootstrap')
      .flush(
        { message: 'Token de bootstrap inválido ou expirado' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await fixture.whenStable();

    expect(el.textContent).toContain('Token de bootstrap inválido ou expirado');
    expect(navigate).not.toHaveBeenCalled();
  });
});
