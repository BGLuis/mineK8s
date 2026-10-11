import { SettingView, SettingsSnapshot } from '../../core/api';
import {
  buildChanges,
  currentText,
  inviteKeyEnabled,
  nodeSharingEnabled,
  sourceDetail,
  validateDraft,
} from './settings.logic';

const tailnet: SettingView = {
  key: 'tailscale.tailnet',
  type: 'text',
  label: 'Nome da tailnet',
  description: '',
  envName: 'TAILNET_NAME',
  source: 'environment',
  value: 'exemplo.ts.net',
};
const interval: SettingView = {
  key: 'healthBot.intervalMs',
  type: 'integer',
  label: 'Intervalo',
  description: '',
  envName: 'HEALTH_BOT_INTERVAL_MS',
  source: 'default',
  value: 300000,
  min: 1000,
  max: 86400000,
};
const inviteKey: SettingView = {
  key: 'tailscale.inviteKeyEnabled',
  type: 'boolean',
  label: 'Convite com chave',
  description: '',
  envName: 'TAILSCALE_INVITE_KEY_ENABLED',
  source: 'default',
  value: false,
};
const apiKey: SettingView = {
  key: 'tailscale.apiKey',
  type: 'secret',
  label: 'Chave de API',
  description: '',
  envName: 'TAILSCALE_API_KEY',
  source: 'database',
  isSet: true,
};
const all = [tailnet, interval, inviteKey, apiKey];
const none = new Set<string>();

describe('buildChanges', () => {
  it('sends nothing when nothing was touched', () => {
    expect(buildChanges(all, {}, none)).toEqual({});
  });

  it('sends only the fields that differ from the current value', () => {
    const draft = {
      'tailscale.tailnet': 'exemplo.ts.net',
      'healthBot.intervalMs': '60000',
      'tailscale.inviteKeyEnabled': false,
    };

    expect(buildChanges(all, draft, none)).toEqual({ 'healthBot.intervalMs': 60000 });
  });

  it('sends a toggled flag as a boolean and trims typed text', () => {
    const draft = { 'tailscale.tailnet': '  outra.ts.net ', 'tailscale.inviteKeyEnabled': true };

    expect(buildChanges(all, draft, none)).toEqual({
      'tailscale.tailnet': 'outra.ts.net',
      'tailscale.inviteKeyEnabled': true,
    });
  });

  it('never sends a secret that was left empty, and sends one that was typed', () => {
    expect(buildChanges(all, { 'tailscale.apiKey': '' }, none)).toEqual({});
    expect(buildChanges(all, { 'tailscale.apiKey': ' tskey-api-FAKE-0000 ' }, none)).toEqual({
      'tailscale.apiKey': 'tskey-api-FAKE-0000',
    });
  });

  it('sends null for a saved value that goes back to the environment', () => {
    expect(buildChanges(all, {}, new Set(['tailscale.apiKey']))).toEqual({
      'tailscale.apiKey': null,
    });
  });
});

describe('validateDraft', () => {
  it('flags an interval outside the allowed range and a blank required field', () => {
    const errors = validateDraft(all, { 'healthBot.intervalMs': '10', 'tailscale.tailnet': '  ' });

    expect(Object.keys(errors).sort()).toEqual(['healthBot.intervalMs', 'tailscale.tailnet']);
  });

  it('accepts valid values and ignores untouched fields and empty secrets', () => {
    expect(validateDraft(all, { 'healthBot.intervalMs': '60000', 'tailscale.apiKey': '' })).toEqual(
      {},
    );
  });

  it('rejects a secret with spaces and a URL without a scheme', () => {
    const publicUrl: SettingView = {
      ...tailnet,
      key: 'access.publicUrl',
      type: 'url',
      label: 'URL pública',
    };

    expect(
      Object.keys(validateDraft([apiKey], { 'tailscale.apiKey': 'has space inside' })),
    ).toEqual(['tailscale.apiKey']);
    expect(
      validateDraft([publicUrl], { 'access.publicUrl': 'painel.mine.internal' }),
    ).toHaveProperty('access.publicUrl');
    expect(
      validateDraft([publicUrl], { 'access.publicUrl': 'https://painel.mine.internal' }),
    ).toEqual({});
  });
});

describe('sourceDetail', () => {
  const format = () => '11/10 08:30';

  it('names the environment variable behind an inherited value', () => {
    expect(sourceDetail(tailnet, format)).toBe('Ambiente (TAILNET_NAME)');
    expect(sourceDetail(interval, format)).toBe('Padrão');
  });

  it('says who saved a value and when', () => {
    const saved = {
      ...tailnet,
      source: 'database',
      updatedBy: 'AdminSteve',
      updatedAt: 'x',
    } as const;

    expect(sourceDetail(saved, format)).toBe('Salvo no painel · AdminSteve · 11/10 08:30');
  });
});

describe('currentText', () => {
  it('has no text for a secret, which the server never sends', () => {
    expect(currentText(apiKey)).toBe('');
    expect(currentText(interval)).toBe('300000');
  });
});

describe('inviteKeyEnabled', () => {
  const snapshot = (value: boolean): SettingsSnapshot => ({
    sections: [
      { id: 'tailscale', title: 'Tailscale', description: '', settings: [{ ...inviteKey, value }] },
    ],
    readOnly: [],
  });

  it('reads the switch from the settings', () => {
    expect(inviteKeyEnabled(snapshot(true))).toBe(true);
    expect(inviteKeyEnabled(snapshot(false))).toBe(false);
  });
});

describe('nodeSharingEnabled', () => {
  const snapshot = (value: boolean): SettingsSnapshot => ({
    sections: [
      {
        id: 'tailscale',
        title: 'Tailscale',
        description: '',
        settings: [
          {
            key: 'tailscale.nodeSharingEnabled',
            type: 'boolean',
            label: 'Compartilhamento de nó',
            description: '',
            envName: 'TAILSCALE_NODE_SHARING_ENABLED',
            source: 'default',
            value,
          },
        ],
      },
    ],
    readOnly: [],
  });

  it('reflete o valor da configuração', () => {
    expect(nodeSharingEnabled(snapshot(true))).toBe(true);
    expect(nodeSharingEnabled(snapshot(false))).toBe(false);
  });
});
