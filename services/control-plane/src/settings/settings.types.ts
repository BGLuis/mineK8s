import type { SettingKey, SettingSectionId, SettingType } from './settings.definitions';

/** Where the effective value of a setting comes from, in precedence order. */
export type SettingSource = 'database' | 'environment' | 'default';

/** What AppConfigService needs from the settings store; the store itself depends on AppConfigService. */
export interface EffectiveSettings {
  getString(key: SettingKey): string;
  getBoolean(key: SettingKey): boolean;
  getNumber(key: SettingKey): number;
}

export interface SettingView {
  key: string;
  type: SettingType;
  label: string;
  description: string;
  placeholder?: string;
  min?: number;
  max?: number;
  /** Main environment variable behind the setting. */
  envName: string;
  source: SettingSource;
  /** Absent for secrets: the API never returns them. */
  value?: string | number | boolean;
  defaultValue?: string | number | boolean;
  /** Only for secrets: whether any value (database or environment) is in effect. */
  isSet?: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface SettingSectionView {
  id: SettingSectionId;
  title: string;
  description: string;
  settings: SettingView[];
}

/** A value that only changes in the Kubernetes manifest and needs a restart to take effect. */
export interface ReadOnlySettingView {
  key: string;
  label: string;
  envName: string;
  value: string;
}

export interface SettingsSnapshot {
  sections: SettingSectionView[];
  readOnly: ReadOnlySettingView[];
}
