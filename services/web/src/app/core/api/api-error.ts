import { HttpErrorResponse } from '@angular/common/http';

/** Unwraps errors that Angular resources wrap around the original HttpErrorResponse. */
export function asHttpError(error: unknown): HttpErrorResponse | null {
  if (error instanceof HttpErrorResponse) {
    return error;
  }
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return cause instanceof HttpErrorResponse ? cause : null;
}

/** Extracts the backend message string or array, joining multiple lines/items. */
export function extractErrorMessage(error: unknown): string | null {
  const http = asHttpError(error);
  if (!http) {
    return null;
  }
  const body = http.error as { message?: unknown } | null;
  const message = body?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message) && message.length > 0) {
    return message.filter((item) => typeof item === 'string').join(' ');
  }
  return null;
}

/** Readable pt-BR message for a failed API call; prefers the backend message when there is one. */
export function apiErrorMessage(error: unknown, fallback = 'Tente de novo em instantes.'): string {
  const http = asHttpError(error);
  if (!http) {
    return fallback;
  }
  if (http.status === 0) {
    return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
  }
  const message = extractErrorMessage(http);
  if (message) {
    return message;
  }
  if (http.status === 403) {
    return 'Você não tem permissão para fazer isso.';
  }
  return fallback;
}

/** Readable reason from an HTTP error, falling back to a generic sentence. */
export function errorReason(error: unknown, fallback = 'Tente novamente em instantes.'): string {
  const http = asHttpError(error);
  if (http?.status === 0) {
    return 'Sem conexão com o servidor de controle.';
  }
  if (http?.status === 403) {
    return 'Você não tem permissão para esta ação.';
  }
  const message = extractErrorMessage(error);
  return message ?? fallback;
}
