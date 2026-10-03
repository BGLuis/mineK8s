/** Canonical Minecraft nick rule (C-06). The backend claim DTO still accepts 2 characters; the UI does not. */
export const NICK_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

export const NICK_HELP = '3 a 16 letras, números ou _';

/** Returns the message to show for an invalid nick, or null when valid. Surrounding spaces are ignored. */
export function validateNick(raw: string): string | null {
  const nick = raw.trim();
  if (!nick) {
    return 'Informe seu nick do Minecraft.';
  }
  return NICK_PATTERN.test(nick) ? null : 'Use 3 a 16 letras, números ou _';
}
