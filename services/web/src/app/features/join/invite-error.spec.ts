import { HttpErrorResponse } from '@angular/common/http';

import { inviteErrorView } from './invite-error';

function failure(status: number, message?: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: message ? { message } : null });
}

describe('inviteErrorView', () => {
  it('explains a depleted invite (409)', () => {
    expect(inviteErrorView(failure(409, 'O limite de utilizações deste convite foi atingido')).title).toBe(
      'Este convite já foi usado',
    );
  });

  it('tells a revoked invite from an expired one even though both are 400', () => {
    expect(inviteErrorView(failure(400, 'Este convite foi revogado pelo administrador')).title).toBe(
      'Este convite foi cancelado',
    );
    expect(inviteErrorView(failure(400, 'Este convite expirou')).title).toBe('Este convite expirou');
  });

  it('treats an unknown token (404) as not found', () => {
    const view = inviteErrorView(failure(404, 'Convite não encontrado ou token inválido'));
    expect(view.title).toBe('Convite não encontrado');
    expect(view.retryable).toBe(false);
  });

  it('only offers a retry when the server could not be reached', () => {
    expect(inviteErrorView(failure(0)).retryable).toBe(true);
    expect(inviteErrorView(failure(503)).retryable).toBe(true);
    expect(inviteErrorView(failure(409)).retryable).toBe(false);
  });

  it('never renders the raw backend message', () => {
    const view = inviteErrorView(failure(400, '<img src=x onerror=alert(1)> expirou'));
    expect(view.text).not.toContain('<img');
  });
});
