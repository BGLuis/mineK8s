import { HttpErrorResponse } from '@angular/common/http';

/** Unwraps errors that Angular resources wrap around the original HttpErrorResponse. */
export function asHttpError(error: unknown): HttpErrorResponse | null {
  if (error instanceof HttpErrorResponse) {
    return error;
  }
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return cause instanceof HttpErrorResponse ? cause : null;
}

/** Readable pt-BR message for a failed API call; prefers the backend message when there is one. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const http = asHttpError(error);
  if (!http) {
    return fallback;
  }
  if (http.status === 0) {
    return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.';
  }
  const message = (http.error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message) && message.length > 0) {
    return message.filter((item) => typeof item === 'string').join('. ');
  }
  if (http.status === 403) {
    return 'Você não tem permissão para fazer isso.';
  }
  return fallback;
}
