export interface SharedPlayerValues {
  email: string;
  nick: string;
}

export interface SharedPlayerErrors {
  email: string;
  nick: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICK_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

/** Mirrors RegisterSharedPlayerDto: a valid e-mail and a 3-16 character Minecraft nickname. */
export function validateSharedPlayer(values: SharedPlayerValues): SharedPlayerErrors {
  return {
    email: EMAIL_PATTERN.test(values.email.trim())
      ? ''
      : 'Informe o e-mail da conta Tailscale da pessoa.',
    nick: NICK_PATTERN.test(values.nick.trim())
      ? ''
      : 'Use de 3 a 16 letras, números ou sublinhado (_), sem espaços.',
  };
}

export function hasSharedPlayerErrors(errors: SharedPlayerErrors): boolean {
  return Object.values(errors).some((message) => message !== '');
}
