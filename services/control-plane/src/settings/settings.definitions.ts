export type SettingType = 'text' | 'url' | 'domain' | 'boolean' | 'integer' | 'secret';

export type SettingSectionId = 'tailscale' | 'access' | 'cloudflare' | 'healthBot';

export type SettingScalar = string | number | boolean;

export interface SettingDefinition {
  key: string;
  section: SettingSectionId;
  type: SettingType;
  /** Text shown on the panel (Portuguese). */
  label: string;
  description: string;
  /** Environment variables that feed this setting, most specific first. */
  envNames: readonly string[];
  /** Effective value when neither the database nor the environment has one; null for secrets. */
  defaultValue: SettingScalar | null;
  placeholder?: string;
  min?: number;
  max?: number;
}

export interface SettingSection {
  id: SettingSectionId;
  title: string;
  description: string;
}

export const SETTING_SECTIONS: readonly SettingSection[] = [
  {
    id: 'tailscale',
    title: 'Tailscale',
    description: 'Como a rede privada identifica e recebe os jogadores.',
  },
  {
    id: 'access',
    title: 'Convites e entrada',
    description: 'Endereços que aparecem nos convites e nas instruções para o jogador.',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    description: 'DNS dos mundos publicados na internet.',
  },
  {
    id: 'healthBot',
    title: 'Bot de saúde',
    description: 'Teste periódico de login em cada mundo ligado.',
  },
];

export const SETTING_DEFINITIONS = [
  {
    key: 'tailscale.apiKey',
    section: 'tailscale',
    type: 'secret',
    label: 'Chave de API do Tailscale',
    description:
      'Lista e remove dispositivos, gera chaves de acesso e audita a política da rede. Só é gravada: o painel nunca a mostra de volta.',
    envNames: ['TAILSCALE_API_KEY'],
    defaultValue: null,
    placeholder: 'tskey-api-…',
  },
  {
    key: 'tailscale.tailnet',
    section: 'tailscale',
    type: 'text',
    label: 'Nome da tailnet',
    description:
      'O nome que aparece em Settings > General no Tailscale (ex.: exemplo.ts.net). Use - para a tailnet padrão da chave de API.',
    envNames: ['TAILNET_NAME', 'TAILSCALE_TAILNET'],
    defaultValue: '-',
    placeholder: 'exemplo.ts.net',
  },
  {
    key: 'tailscale.inviteKeyEnabled',
    section: 'tailscale',
    type: 'boolean',
    label: 'Convite com chave de acesso',
    description:
      'Permite criar e usar convites que geram uma chave de acesso do Tailscale. Fica desligado porque os apps do Tailscale com interface não aceitam essa chave.',
    envNames: ['TAILSCALE_INVITE_KEY_ENABLED'],
    defaultValue: false,
  },
  {
    key: 'tailscale.nodeSharingEnabled',
    section: 'tailscale',
    type: 'boolean',
    label: 'Compartilhamento de nó',
    description:
      'Entrada de jogadores pelo compartilhamento do nó do Tailscale. A opção já fica gravada; o fluxo ainda não existe.',
    envNames: ['TAILSCALE_NODE_SHARING_ENABLED'],
    defaultValue: true,
  },
  {
    key: 'access.publicUrl',
    section: 'access',
    type: 'url',
    label: 'URL pública do painel',
    description:
      'Endereço que o convidado abre para chegar à página /join. É a base dos links de convite.',
    envNames: ['PUBLIC_BASE_URL', 'APP_URL'],
    defaultValue: 'http://localhost:3000',
    placeholder: 'https://painel.mine.internal',
  },
  {
    key: 'access.worldsDomain',
    section: 'access',
    type: 'domain',
    label: 'Domínio dos mundos',
    description:
      'O que o jogador digita no Minecraft depois do nome do mundo, como mine.internal em sekiro.mine.internal. O DNS precisa apontar para o gateway.',
    envNames: ['WORLDS_BASE_DOMAIN'],
    defaultValue: '',
    placeholder: 'mine.internal',
  },
  {
    key: 'cloudflare.apiToken',
    section: 'cloudflare',
    type: 'secret',
    label: 'Token da Cloudflare',
    description:
      'Cria e remove os registros DNS dos mundos publicados. Só é gravado: o painel nunca o mostra de volta.',
    envNames: ['CLOUDFLARE_API_TOKEN'],
    defaultValue: null,
  },
  {
    key: 'cloudflare.zoneId',
    section: 'cloudflare',
    type: 'text',
    label: 'ID da zona',
    description: 'Aparece na visão geral da zona, no painel da Cloudflare.',
    envNames: ['CLOUDFLARE_ZONE_ID'],
    defaultValue: '',
  },
  {
    key: 'cloudflare.rootDomain',
    section: 'cloudflare',
    type: 'domain',
    label: 'Domínio raiz',
    description: 'Domínio da zona, sob o qual os registros dos mundos são criados.',
    envNames: ['CLOUDFLARE_ROOT_DOMAIN'],
    defaultValue: 'minek8s.net',
    placeholder: 'minek8s.net',
  },
  {
    key: 'healthBot.enabled',
    section: 'healthBot',
    type: 'boolean',
    label: 'Bot de saúde ativado',
    description: 'Testa o login de cada mundo ligado e guarda o resultado na página de saúde.',
    envNames: ['HEALTH_BOT_ENABLED'],
    defaultValue: true,
  },
  {
    key: 'healthBot.intervalMs',
    section: 'healthBot',
    type: 'integer',
    label: 'Intervalo entre testes (ms)',
    description: 'Tempo entre um ciclo de testes e o próximo.',
    envNames: ['HEALTH_BOT_INTERVAL_MS'],
    defaultValue: 300_000,
    min: 1_000,
    max: 86_400_000,
  },
  {
    key: 'healthBot.timeoutMs',
    section: 'healthBot',
    type: 'integer',
    label: 'Tempo limite de cada teste (ms)',
    description: 'Quanto o bot espera pela resposta de um mundo antes de dá-lo como fora do ar.',
    envNames: ['HEALTH_BOT_TIMEOUT_MS'],
    defaultValue: 5_000,
    min: 1_000,
    max: 120_000,
  },
] as const satisfies readonly SettingDefinition[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]['key'];

export const DEFINITIONS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export type ParsedSetting = { ok: true; stored: string } | { ok: false; error: string };

const TAILNET = /^(-|[A-Za-z0-9][A-Za-z0-9._@-]*)$/;
const SECRET = /^\S{8,512}$/;
const ZONE_ID = /^[A-Za-z0-9]{8,64}$/;
const DOMAIN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const fail = (error: string): ParsedSetting => ({ ok: false, error });
const accept = (stored: string): ParsedSetting => ({ ok: true, stored });

function parseInteger(definition: SettingDefinition, raw: string): ParsedSetting {
  const value = Number(raw);
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = definition;
  if (raw === '' || !Number.isInteger(value) || value < min || value > max) {
    return fail(`informe um número inteiro entre ${min} e ${max}.`);
  }
  return accept(String(value));
}

function parseUrl(raw: string): ParsedSetting {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail('informe um endereço completo, como https://painel.exemplo.com.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || raw.length > 200) {
    return fail('use um endereço http:// ou https:// de até 200 caracteres.');
  }
  if (url.username || url.password || url.search || url.hash) {
    return fail('o endereço não pode ter usuário, senha, parâmetros nem âncora.');
  }
  return accept(`${url.origin}${url.pathname}`.replace(/\/+$/, ''));
}

/**
 * Validates and normalizes a value into the text form kept in the database. Environment values go through the
 * same rules, so an invalid variable falls back to the default instead of breaking a consumer.
 */
export function parseSetting(definition: SettingDefinition, input: unknown): ParsedSetting {
  if (definition.type === 'boolean') {
    const text = typeof input === 'string' ? input.trim().toLowerCase() : input;
    if (text === true || text === 'true') {
      return accept('true');
    }
    if (text === false || text === 'false') {
      return accept('false');
    }
    return fail('use verdadeiro ou falso.');
  }
  if (typeof input === 'number' && definition.type === 'integer') {
    return parseInteger(definition, String(input));
  }
  if (typeof input !== 'string') {
    return fail('informe um texto.');
  }
  const raw = input.trim();

  switch (definition.type) {
    case 'integer':
      return parseInteger(definition, raw);
    case 'url':
      return parseUrl(raw);
    case 'domain':
      return DOMAIN.test(raw.toLowerCase())
        ? accept(raw.toLowerCase())
        : fail('informe só o domínio, como mine.internal.');
    case 'secret':
      return SECRET.test(raw) ? accept(raw) : fail('informe a chave inteira, sem espaços.');
    default:
      return parseText(definition, raw);
  }
}

function parseText(definition: SettingDefinition, raw: string): ParsedSetting {
  if (definition.key === 'tailscale.tailnet') {
    return TAILNET.test(raw) && raw.length <= 100
      ? accept(raw)
      : fail('use o nome da tailnet (como exemplo.ts.net) ou -.');
  }
  if (definition.key === 'cloudflare.zoneId') {
    return ZONE_ID.test(raw) ? accept(raw) : fail('informe o ID da zona, só letras e números.');
  }
  return raw.length > 0 && raw.length <= 200 ? accept(raw) : fail('informe um texto curto.');
}

/** Converts the stored text into the typed value consumers use. */
export function typedValue(definition: SettingDefinition, stored: string): SettingScalar {
  if (definition.type === 'boolean') {
    return stored === 'true';
  }
  return definition.type === 'integer' ? Number(stored) : stored;
}
