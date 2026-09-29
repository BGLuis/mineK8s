/**
 * Validador estrito de regras de nomenclatura do Minecraft Vanilla (RF-ARQ-21, GW:430-432).
 * Padrão: ^[a-zA-Z0-9_]{2,16}$
 */
export const MINECRAFT_NICK_REGEX = /^[a-zA-Z0-9_]{2,16}$/;

export interface NickValidationResult {
  valid: boolean;
  reason?: string;
}

export function isValidMinecraftNick(nick: string): boolean {
  if (!nick || typeof nick !== 'string') {
    return false;
  }
  return MINECRAFT_NICK_REGEX.test(nick);
}

export function validateNicknameFormat(nick: string): NickValidationResult {
  if (!nick || typeof nick !== 'string') {
    return { valid: false, reason: 'NICKNAME_EMPTY' };
  }

  // Prevenção de caracteres de injeção e quebras de linha
  if (nick.includes('\0') || nick.includes('\r') || nick.includes('\n')) {
    return { valid: false, reason: 'CONTROL_CHARACTERS_NOT_ALLOWED' };
  }

  if (nick.includes('/') || nick.includes('\\') || nick.includes('..')) {
    return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
  }

  if (nick.includes(' ')) {
    return { valid: false, reason: 'SPACES_NOT_ALLOWED' };
  }

  if (nick.length < 2) {
    return { valid: false, reason: 'NICKNAME_TOO_SHORT' };
  }

  if (nick.length > 16) {
    return { valid: false, reason: 'NICKNAME_TOO_LONG' };
  }

  if (!MINECRAFT_NICK_REGEX.test(nick)) {
    return { valid: false, reason: 'INVALID_CHARACTERS' };
  }

  return { valid: true };
}
