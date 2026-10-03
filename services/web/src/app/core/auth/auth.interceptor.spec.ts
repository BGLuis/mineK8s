import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { authInterceptor } from './auth.interceptor';
import { TokenStore } from './token-store';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let tokens: TokenStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => controller.verify());

  it('adds the Bearer token to API calls', () => {
    tokens.set('jwt-123');
    http.get('/api/servers').subscribe();

    const req = controller.expectOne('/api/servers');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-123');
    req.flush([]);
  });

  it('sends no Authorization header without a token', () => {
    http.get('/api/servers').subscribe();

    const req = controller.expectOne('/api/servers');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('never leaks the token to non-API URLs', () => {
    tokens.set('jwt-123');
    http.get('https://example.com/api/servers').subscribe();
    http.get('/assets/icon.svg').subscribe();

    for (const req of controller.match(() => true)) {
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush('');
    }
  });

  it('drops the session and goes to /login when an API call comes back 401', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    tokens.set('expired');
    http.get('/api/servers').subscribe({ error: () => undefined });

    controller.expectOne('/api/servers').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(tokens.token()).toBeNull();
    expect(sessionStorage.getItem('mc.access_token')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('keeps the session when a failed login attempt returns 401', () => {
    tokens.set('still-valid');
    http.post('/api/auth/token', {}).subscribe({ error: () => undefined });

    controller.expectOne('/api/auth/token').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(tokens.token()).toBe('still-valid');
  });
});
