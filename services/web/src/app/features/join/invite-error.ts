import { HttpErrorResponse } from '@angular/common/http';

import { asHttpError } from './api-error';

export interface InviteErrorView {
  title: string;
  text: string;
  /** Network and server failures can be retried; a bad invite cannot. */
  retryable: boolean;
  /** A feature switched off by the admin is a notice, not the visitor's mistake. */
  notice?: boolean;
}

const ASK_FOR_NEW_LINK = 'Peça um link novo para quem convidou você.';

/**
 * Maps the failure of GET /api/tailscale/invites/validate/:token to a friendly card.
 * Both revoked and expired are 400, so the backend error `code` tells them apart. 403 means the admin
 * turned key invites off.
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
  if (http.status === 403 && codeOf(http) === 'INVITE_KEY_DISABLED') {
    return {
      title: 'Convites por chave estão desativados',
      text: 'Esta rede não usa mais convite com chave de acesso. Peça a quem administra a rede para liberar seu acesso pelo Tailscale.',
      retryable: false,
      notice: true,
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
    const code = codeOf(http);
    if (code === 'INVITE_REVOKED') {
      return {
        title: 'Este convite foi cancelado',
        text: `Quem convidou você desativou este link. ${ASK_FOR_NEW_LINK}`,
        retryable: false,
      };
    }
    if (code === 'INVITE_EXPIRED') {
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

function codeOf(error: HttpErrorResponse): string {
  const code = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}
