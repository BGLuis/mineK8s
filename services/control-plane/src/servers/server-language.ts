/** Languages of the texts the gateway shows the Minecraft client (the client does not tell its own). */
export const SERVER_LANGUAGES = ['pt-BR', 'en'] as const;

export type ServerLanguage = (typeof SERVER_LANGUAGES)[number];

export const DEFAULT_SERVER_LANGUAGE: ServerLanguage = 'pt-BR';

/**
 * The MOTD a new world starts with: its name in green and bold, then a friendly line. `\n` is the two
 * characters backslash and n, as in server.properties; the writer turns it into a line break.
 */
export function defaultMotd(name: string, language: ServerLanguage): string {
  const line = language === 'en' ? 'Join in and have fun!' : 'Entre e bom jogo!';
  return `§a§l${name}\\n§7${line}`;
}

export type ShutdownAction = 'stop' | 'restart' | 'update-version';

/**
 * Mensagem de contagem regressiva para aviso aos jogadores antes de parar/reiniciar/atualizar (RF-ARQ-08, #204).
 */
export function formatCountdownMessage(
  action: ShutdownAction,
  remainingSeconds: number,
  language: ServerLanguage = DEFAULT_SERVER_LANGUAGE,
): string {
  const isEn = language === 'en';
  if (remainingSeconds >= 60) {
    const minutes = Math.round(remainingSeconds / 60);
    if (action === 'update-version') {
      return isEn
        ? `The server will shut down for update in ${minutes} minute${minutes > 1 ? 's' : ''}.`
        : `O servidor será desligado para atualização em ${minutes} minuto${minutes > 1 ? 's' : ''}.`;
    }
    if (action === 'restart') {
      return isEn
        ? `The server will restart in ${minutes} minute${minutes > 1 ? 's' : ''}.`
        : `O servidor será reiniciado em ${minutes} minuto${minutes > 1 ? 's' : ''}.`;
    }
    return isEn
      ? `The server will shut down in ${minutes} minute${minutes > 1 ? 's' : ''}.`
      : `O servidor será desligado em ${minutes} minuto${minutes > 1 ? 's' : ''}.`;
  }

  if (action === 'update-version') {
    return isEn
      ? `The server will shut down for update in ${remainingSeconds} seconds.`
      : `O servidor será desligado para atualização em ${remainingSeconds} segundos.`;
  }
  if (action === 'restart') {
    return isEn
      ? `The server will restart in ${remainingSeconds} seconds.`
      : `O servidor será reiniciado em ${remainingSeconds} segundos.`;
  }
  return isEn
    ? `The server will shut down in ${remainingSeconds} seconds.`
    : `O servidor será desligado em ${remainingSeconds} segundos.`;
}

/**
 * Mensagem enviada aos jogadores quando a parada ou reinício é cancelado (#204).
 */
export function formatCountdownCancelledMessage(
  action: ShutdownAction,
  language: ServerLanguage = DEFAULT_SERVER_LANGUAGE,
): string {
  const isEn = language === 'en';
  if (action === 'update-version') {
    return isEn
      ? 'The server update has been cancelled.'
      : 'A atualização do servidor foi cancelada.';
  }
  if (action === 'restart') {
    return isEn
      ? 'The server restart has been cancelled.'
      : 'O reinício do servidor foi cancelado.';
  }
  return isEn ? 'The server shutdown has been cancelled.' : 'A parada do servidor foi cancelada.';
}
