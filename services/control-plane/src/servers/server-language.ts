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
