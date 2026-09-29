import { LogEntry } from './circular-log-buffer';

/**
 * Filtro de ruído RCON e sanitizador de logs do servidor Minecraft (RF-RCON-09).
 */
export class LogNoiseFilter {
  private static readonly IGNORED_PATTERNS: RegExp[] = [
    /Thread RCON Client \/\d+\.\d+\.\d+\.\d+:\d+ started/i,
    /Thread RCON Client \/\d+\.\d+\.\d+\.\d+:\d+ shut down/i,
    /RCON Client \/\d+\.\d+\.\d+\.\d+:\d+ shut down/i,
    /RCON connection from: \/\d+\.\d+\.\d+\.\d+/i,
    /logged in via rcon/i,
    /Failed to handle packet SERVERDATA_EXECCOMMAND/i,
  ];

  // Regex para identificar mensagens de chat enviadas por jogadores
  private static readonly CHAT_PATTERNS: RegExp[] = [
    /<[^>]+>/, // Padrão clássico: <PlayerName> mensagem
    /\[Chat\]/i,
    /\[Not Secure\] <[^>]+>/,
  ];

  /**
   * Verifica se a linha de log é ruído de telemetria/RCON.
   * Garante que mensagens de chat de jogadores citando RCON NÃO sejam descartadas (Critério de Aceite RF-RCON-09).
   */
  public static isNoise(rawMessage: string): boolean {
    const cleanMessage = this.sanitizeAnsi(rawMessage);

    // Se a mensagem for chat de jogador, preserva sempre
    const isPlayerChat = this.CHAT_PATTERNS.some((pattern) =>
      pattern.test(cleanMessage),
    );
    if (isPlayerChat) {
      return false;
    }

    return this.IGNORED_PATTERNS.some((pattern) => pattern.test(cleanMessage));
  }

  /**
   * Remove sequências de escape ANSI corrompidas ou de controle de terminal.
   */
  public static sanitizeAnsi(rawMessage: string): string {
    return rawMessage.replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      '',
    );
  }

  /**
   * Converte uma linha bruta de log em um objeto LogEntry tipado.
   */
  public static parseLogEntry(rawLine: string, lineId?: string): LogEntry {
    const cleanLine = this.sanitizeAnsi(rawLine).trim();
    let level: 'INFO' | 'WARN' | 'ERROR' = 'INFO';

    if (/\b(WARN|WARNING)\b/i.test(cleanLine)) {
      level = 'WARN';
    } else if (/\b(ERROR|FATAL|SEVERE|Exception)\b/i.test(cleanLine)) {
      level = 'ERROR';
    }

    // Tenta extrair timestamp no formato [HH:mm:ss] ou similar
    const timestampMatch = cleanLine.match(/^\[?(\d{2}:\d{2}:\d{2})\]?/);
    const timestamp = timestampMatch
      ? timestampMatch[1]
      : new Date().toISOString();

    return {
      id: lineId || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp,
      level,
      message: cleanLine,
    };
  }
}
