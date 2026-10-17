export interface SharedPlayerValues {
  email: string;
  github?: string;
  nick: string;
}

export interface SharedPlayerErrors {
  identity: string;
  email: string;
  github: string;
  nick: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const NICK_PATTERN = /^[a-zA-Z0-9_]{3,16}$/;

export function normalizeGithubInput(raw?: string | null): string {
  if (!raw) {
    return '';
  }
  let clean = raw.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\/github\.com\//, '');
  clean = clean.replace(/@\.?github(\.com)?$/, '');
  clean = clean.replace(/^@/, '');
  return clean.trim();
}

/** Mirrors RegisterSharedPlayerDto: a valid e-mail and/or GitHub username, and a 3-16 character Minecraft nickname. */
export function validateSharedPlayer(values: SharedPlayerValues): SharedPlayerErrors {
  const trimmedEmail = values.email.trim();
  const trimmedGithub = normalizeGithubInput(values.github);
  const trimmedNick = values.nick.trim();

  let emailError = '';
  if (trimmedEmail) {
    if (!EMAIL_PATTERN.test(trimmedEmail) && !trimmedEmail.endsWith('@github')) {
      emailError = 'Informe um e-mail válido.';
    }
  }

  let githubError = '';
  if (values.github && values.github.trim()) {
    if (!trimmedGithub || !GITHUB_PATTERN.test(trimmedGithub)) {
      githubError = 'Usuário do GitHub inválido (letras, números e hífens).';
    }
  }

  let identityError = '';
  if (!trimmedEmail && !trimmedGithub) {
    identityError = 'Informe o e-mail ou o usuário do GitHub da conta Tailscale.';
  }

  const nickError = NICK_PATTERN.test(trimmedNick)
    ? ''
    : 'Use de 3 a 16 letras, números ou sublinhado (_), sem espaços.';

  return {
    identity: identityError,
    email: emailError,
    github: githubError,
    nick: nickError,
  };
}

export function hasSharedPlayerErrors(errors: SharedPlayerErrors): boolean {
  return Object.values(errors).some((message) => message !== '');
}
