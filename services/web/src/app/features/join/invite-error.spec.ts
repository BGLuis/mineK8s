import { HttpErrorResponse } from '@angular/common/http';

import { inviteErrorView } from './invite-error';

function failure(status: number, code?: string, message = 'backend text'): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: code ? { code, message } : null });
}

describe('inviteErrorView', () => {
  it('explains a depleted invite (409)', () => {
    expect(inviteErrorView(failure(409, 'INVITE_DEPLETED')).title).toBe(
      'Este convite já foi usado',
    );
  });

  it('tells a revoked invite from an expired one even though both are 400', () => {
    expect(inviteErrorView(failure(400, 'INVITE_REVOKED')).title).toBe(
      'Este convite foi cancelado',
    );
    expect(inviteErrorView(failure(400, 'INVITE_EXPIRED')).title).toBe('Este convite expirou');
  });

  it('explains that key invites were turned off (403) as a notice, not a bad link', () => {
    const view = inviteErrorView(failure(403, 'INVITE_KEY_DISABLED'));

    expect(view.title).toBe('Convites por chave estão desativados');
    expect(view.notice).toBe(true);
    expect(view.retryable).toBe(false);
    expect(inviteErrorView(failure(403, 'FORBIDDEN')).notice).toBeUndefined();
  });

  it('treats an unknown token (404) as not found', () => {
    const view = inviteErrorView(failure(404, 'INVITE_NOT_FOUND'));
    expect(view.title).toBe('Convite não encontrado');
    expect(view.retryable).toBe(false);
  });

  it('only offers a retry when the server could not be reached', () => {
    expect(inviteErrorView(failure(0)).retryable).toBe(true);
    expect(inviteErrorView(failure(503)).retryable).toBe(true);
    expect(inviteErrorView(failure(409)).retryable).toBe(false);
  });

  it('never renders the raw backend message', () => {
    const view = inviteErrorView(failure(400, 'INVITE_EXPIRED', '<img src=x onerror=alert(1)>'));
    expect(view.text).not.toContain('<img');
  });
});
