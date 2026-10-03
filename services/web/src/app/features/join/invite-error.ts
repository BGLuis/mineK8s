import { HttpErrorResponse } from '@angular/common/http';

import { asHttpError } from './api-error';

export interface InviteErrorView {
  title: string;
  text: string;
  /** Network and server failures can be retried; a bad invite cannot. */
  retryable: boolean;
}

const ASK_FOR_NEW_LINK = 'Peça um link novo para quem convidou você.';

/**
 * Maps the failure of GET /api/tailscale/invites/validate/:token to a friendly card.
 * The backend distinguishes revoked and expired only by message (both are 400).
 */
export function inviteErrorView(error: unknown): InviteErrorView {
  const http = asHttpError(error);
  if (!http || http.status === 0 || http.status >= 500) {
    return {
      title: 'Não foi possível verificar o convite',
      text: 'O servidor não respondeu. Confira sua conexão e tente de novo.',
      retryable: true,
    };
  }
  if (http.status === 409) {
    return {
      title: 'Este convite já foi usado',
      text: `Todas as vagas deste convite foram preenchidas. ${ASK_FOR_NEW_LINK}`,
      retryable: false,
    };
  }
  if (http.status === 400) {
    const message = messageOf(http).toLowerCase();
    if (message.includes('revogado')) {
      return {
        title: 'Este convite foi cancelado',
        text: `Quem convidou você desativou este link. ${ASK_FOR_NEW_LINK}`,
        retryable: false,
      };
    }
    if (message.includes('expirou')) {
      return {
        title: 'Este convite expirou',
        text: `O prazo deste link acabou. ${ASK_FOR_NEW_LINK}`,
        retryable: false,
      };
    }
  }
  return {
    title: 'Convite não encontrado',
    text: `O link está incompleto ou foi digitado errado. ${ASK_FOR_NEW_LINK}`,
    retryable: false,
  };
}

export const MISSING_TOKEN_VIEW: InviteErrorView = {
  title: 'Faltou o convite',
  text: `Este endereço não traz o código do convite. ${ASK_FOR_NEW_LINK}`,
  retryable: false,
};

function messageOf(error: HttpErrorResponse): string {
  const message = (error.error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
}
