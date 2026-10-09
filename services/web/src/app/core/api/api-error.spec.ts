import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, asHttpError, errorReason, extractErrorMessage } from './api-error';

describe('api-error', () => {
  it('unwraps direct HttpErrorResponse and wrapped causes', () => {
    const direct = new HttpErrorResponse({ status: 400 });
    const wrapped = { cause: direct };
    expect(asHttpError(direct)).toBe(direct);
    expect(asHttpError(wrapped)).toBe(direct);
    expect(asHttpError(new Error('fail'))).toBeNull();
  });

  it('extracts backend message string or array', () => {
    const withString = new HttpErrorResponse({ error: { message: 'Mensagem do backend' } });
    const withArray = new HttpErrorResponse({ error: { message: ['Erro 1', 'Erro 2'] } });
    expect(extractErrorMessage(withString)).toBe('Mensagem do backend');
    expect(extractErrorMessage(withArray)).toBe('Erro 1 Erro 2');
  });

  it('produces human-readable apiErrorMessage in pt-BR', () => {
    const netErr = new HttpErrorResponse({ status: 0 });
    const forbidden = new HttpErrorResponse({ status: 403 });
    const custom = new HttpErrorResponse({ status: 400, error: { message: 'Dado inválido' } });
    expect(apiErrorMessage(netErr)).toContain('Não foi possível falar com o servidor');
    expect(apiErrorMessage(forbidden)).toContain('Você não tem permissão');
    expect(apiErrorMessage(custom)).toBe('Dado inválido');
    expect(apiErrorMessage(new Error('boom'), 'Fallback')).toBe('Fallback');
  });

  it('produces errorReason in pt-BR', () => {
    const netErr = new HttpErrorResponse({ status: 0 });
    const forbidden = new HttpErrorResponse({ status: 403 });
    const custom = new HttpErrorResponse({ status: 500, error: { message: 'Falha interna' } });
    expect(errorReason(netErr)).toContain('Sem conexão');
    expect(errorReason(forbidden)).toContain('Você não tem permissão');
    expect(errorReason(custom)).toBe('Falha interna');
    expect(errorReason(null, 'Padrao')).toBe('Padrao');
  });
});
