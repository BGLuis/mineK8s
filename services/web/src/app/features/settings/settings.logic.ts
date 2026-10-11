import { SettingView, SettingsChanges, SettingsSnapshot } from '../../core/api/models';

/** What the admin typed or toggled, by setting key; settings left alone have no entry. */
export type Draft = Readonly<Record<string, string | boolean>>;

export type SettingErrors = Readonly<Record<string, string>>;

/** The current value as the text field shows it. A secret has no value to show. */
export function currentText(setting: SettingView): string {
  return setting.type === 'secret' || setting.value === undefined ? '' : String(setting.value);
}

export function textOf(setting: SettingView, draft: Draft): string {
  const typed = draft[setting.key];
  return typeof typed === 'string' ? typed : currentText(setting);
}

export function flagOf(setting: SettingView, draft: Draft): boolean {
  const typed = draft[setting.key];
  return typeof typed === 'boolean' ? typed : setting.value === true;
}

export function sourceLabel(setting: SettingView): string {
  switch (setting.source) {
    case 'database':
      return 'Salvo no painel';
    case 'environment':
      return `Ambiente (${setting.envName})`;
    default:
      return 'Padrão';
  }
}

/** "Salvo no painel · AdminSteve · 11/10 08:30": who changed it and when, only for saved values. */
export function sourceDetail(setting: SettingView, formatDate: (iso: string) => string): string {
  const parts = [sourceLabel(setting)];
  if (setting.source === 'database') {
    if (setting.updatedBy) {
      parts.push(setting.updatedBy);
    }
    if (setting.updatedAt) {
      parts.push(formatDate(setting.updatedAt));
    }
  }
  return parts.join(' · ');
}

function typedError(setting: SettingView, text: string): string | null {
  switch (setting.type) {
    case 'integer': {
      const { min = 0, max } = setting;
      const inRange =
        /^\d+$/.test(text) && Number(text) >= min && (max === undefined || Number(text) <= max);
      return inRange ? null : `Informe um número inteiro de ${min} a ${max ?? 'sem limite'}.`;
    }
    case 'url':
      return /^https?:\/\/[^\s/]+\S*$/i.test(text)
        ? null
        : 'Informe o endereço completo, como https://painel.exemplo.com.';
    case 'domain':
      return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
        text,
      )
        ? null
        : 'Informe só o domínio, como mine.internal.';
    case 'secret':
      return /^\S{8,}$/.test(text) ? null : 'Informe o valor inteiro, sem espaços.';
    default:
      return null;
  }
}

/** Errors for the edited text fields only; the server stays the authority on every rule. */
export function validateDraft(settings: readonly SettingView[], draft: Draft): SettingErrors {
  const errors: Record<string, string> = {};
  for (const setting of settings) {
    const typed = draft[setting.key];
    if (typeof typed !== 'string' || setting.type === 'boolean') {
      continue;
    }
    const text = typed.trim();
    if (setting.type === 'secret' && text === '') {
      continue;
    }
    const error =
      text === '' ? 'Preencha o campo ou volte ao valor do ambiente.' : typedError(setting, text);
    if (error) {
      errors[setting.key] = error;
    }
  }
  return errors;
}

/**
 * The PATCH body: only what differs from the current value, plus `null` for the saved values to drop.
 * An untouched secret is never sent, and a typed secret replaces the stored one.
 */
export function buildChanges(
  settings: readonly SettingView[],
  draft: Draft,
  resets: ReadonlySet<string>,
): SettingsChanges {
  const changes: SettingsChanges = {};
  for (const setting of settings) {
    if (resets.has(setting.key)) {
      changes[setting.key] = null;
      continue;
    }
    const typed = draft[setting.key];
    if (typed === undefined) {
      continue;
    }
    if (typeof typed === 'boolean') {
      if (typed !== (setting.value === true)) {
        changes[setting.key] = typed;
      }
      continue;
    }
    const text = typed.trim();
    if (setting.type === 'secret') {
      if (text !== '') {
        changes[setting.key] = text;
      }
    } else if (text !== currentText(setting)) {
      changes[setting.key] = setting.type === 'integer' ? Number(text) : text;
    }
  }
  return changes;
}

/** Whether registering players who receive the shared gateway node is on (on by default). */
export function nodeSharingEnabled(snapshot: SettingsSnapshot): boolean {
  const setting = snapshot.sections
    .flatMap((section) => section.settings)
    .find((item) => item.key === 'tailscale.nodeSharingEnabled');
  return setting?.value === true;
}

/** Whether invites that hand out a Tailscale access key are on (off by default). */
export function inviteKeyEnabled(snapshot: SettingsSnapshot): boolean {
  const setting = snapshot.sections
    .flatMap((section) => section.settings)
    .find((item) => item.key === 'tailscale.inviteKeyEnabled');
  return setting?.value === true;
}
