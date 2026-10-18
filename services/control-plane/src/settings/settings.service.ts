import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { AppSetting } from '@database/entities/app-setting.entity';

import { SecretCipher } from './secret-cipher';
import {
  DEFINITIONS_BY_KEY,
  SETTING_DEFINITIONS,
  SETTING_SECTIONS,
  SettingDefinition,
  SettingKey,
  SettingScalar,
  parseSetting,
  typedValue,
} from './settings.definitions';
import {
  EffectiveSettings,
  ReadOnlySettingView,
  SettingSource,
  SettingView,
  SettingsSnapshot,
} from './settings.types';

interface StoredEntry {
  value: string;
  updatedAt: Date;
  updatedBy: string | null;
}

interface Resolved {
  value: SettingScalar | null;
  source: SettingSource;
}

/**
 * Settings edited on the panel. The effective value of each one is, in order: the database, the environment
 * variable, the default. Rows are cached in memory (single replica), so consumers read synchronously and see a
 * change right after it is saved, without restarting the pod.
 */
@Injectable()
export class SettingsService implements OnModuleInit, EffectiveSettings {
  private readonly logger = new Logger(SettingsService.name);
  private readonly stored = new Map<string, StoredEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly cipher: SecretCipher;

  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
    private readonly config: AppConfigService,
  ) {
    this.cipher = new SecretCipher(config.jwt.secret);
    config.attachSettings(this);
  }

  async onModuleInit(): Promise<void> {
    await this.load();
    this.warnAboutInvalidEnvironment();
  }

  /** Reads every row into memory. Secrets that cannot be decrypted are skipped and fall back to the environment. */
  async load(): Promise<void> {
    this.stored.clear();
    for (const row of await this.repo.find()) {
      const definition = DEFINITIONS_BY_KEY.get(row.key);
      if (!definition) {
        continue;
      }
      try {
        const value = row.is_secret ? this.cipher.decrypt(row.value, row.key) : row.value;
        this.stored.set(row.key, {
          value,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        });
      } catch {
        this.logger.warn(
          `Could not decrypt the stored value of "${row.key}" (did JWT_SECRET change?); using the environment instead. Set it again on the settings page.`,
        );
      }
    }
  }

  getString(key: SettingKey): string {
    return String(this.resolve(this.definition(key)).value ?? '');
  }

  getBoolean(key: SettingKey): boolean {
    return this.resolve(this.definition(key)).value === true;
  }

  getNumber(key: SettingKey): number {
    return Number(this.resolve(this.definition(key)).value);
  }

  /** Called after a change is saved, so long-lived consumers (timers) can pick up the new values. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  snapshot(): SettingsSnapshot {
    return {
      sections: SETTING_SECTIONS.map((section) => ({
        ...section,
        settings: SETTING_DEFINITIONS.filter((definition) => definition.section === section.id).map(
          (definition) => this.view(definition),
        ),
      })),
      readOnly: this.readOnlyValues(),
    };
  }

  /**
   * Applies several changes at once: every value is validated first and nothing is saved if one is invalid.
   * `null` removes the database value, so the environment (or the default) applies again.
   */
  async update(
    changes: Record<string, unknown>,
    updatedBy: string | null,
  ): Promise<SettingsSnapshot> {
    const toSave = new Map<string, { definition: SettingDefinition; stored: string }>();
    const toRemove: string[] = [];
    const errors: string[] = [];

    for (const [key, input] of Object.entries(changes)) {
      const definition = DEFINITIONS_BY_KEY.get(key);
      if (!definition) {
        errors.push(`Configuração desconhecida: ${key}.`);
      } else if (input === null) {
        toRemove.push(key);
      } else {
        const parsed = parseSetting(definition, input);
        if (parsed.ok) {
          toSave.set(key, { definition, stored: parsed.stored });
        } else {
          errors.push(`${definition.label}: ${parsed.error}`);
        }
      }
    }
    if (errors.length > 0) {
      throw new BadRequestException({ message: errors });
    }

    for (const [key, { definition, stored }] of toSave) {
      const isSecret = definition.type === 'secret';
      const saved = await this.repo.save(
        this.repo.create({
          key,
          value: isSecret ? this.cipher.encrypt(stored, key) : stored,
          is_secret: isSecret,
          updated_by: updatedBy,
        }),
      );
      this.stored.set(key, {
        value: stored,
        updatedAt: saved.updated_at ?? new Date(),
        updatedBy,
      });
    }
    for (const key of toRemove) {
      await this.repo.delete({ key });
      this.stored.delete(key);
    }

    const changed = [...toSave.keys(), ...toRemove];
    if (changed.length > 0) {
      // Keys only: values may be secrets.
      this.logger.log(`Settings changed by ${updatedBy ?? 'unknown'}: ${changed.join(', ')}`);
      this.notify();
    }
    return this.snapshot();
  }

  private definition(key: SettingKey): SettingDefinition {
    return DEFINITIONS_BY_KEY.get(key) as SettingDefinition;
  }

  private resolve(definition: SettingDefinition): Resolved {
    const entry = this.stored.get(definition.key);
    if (entry) {
      return { value: typedValue(definition, entry.value), source: 'database' };
    }
    for (const name of definition.envNames) {
      const raw = process.env[name];
      if (raw === undefined || raw.trim() === '') {
        continue;
      }
      const parsed = parseSetting(definition, raw);
      if (parsed.ok) {
        return { value: typedValue(definition, parsed.stored), source: 'environment' };
      }
    }
    return { value: definition.defaultValue, source: 'default' };
  }

  private view(definition: SettingDefinition): SettingView {
    const { value, source } = this.resolve(definition);
    const entry = this.stored.get(definition.key);
    const view: SettingView = {
      key: definition.key,
      type: definition.type,
      label: definition.label,
      description: definition.description,
      placeholder: definition.placeholder,
      min: definition.min,
      max: definition.max,
      envName: definition.envNames[0],
      source,
      updatedAt: entry?.updatedAt.toISOString(),
      updatedBy: entry ? entry.updatedBy : undefined,
    };
    if (definition.type === 'secret') {
      view.isSet = typeof value === 'string' && value !== '';
    } else {
      view.value = value ?? undefined;
      view.defaultValue = definition.defaultValue ?? undefined;
    }
    return view;
  }

  private readOnlyValues(): ReadOnlySettingView[] {
    const list = (items: string[]) => items.join(', ');
    return [
      {
        key: 'port',
        label: 'Porta do painel e da API',
        envName: 'PORT',
        value: String(this.config.port),
      },
      { key: 'apiUrl', label: 'URL da API', envName: 'API_URL', value: this.config.apiUrl },
      {
        key: 'allowedOrigins',
        label: 'Origens aceitas pelo painel (CORS)',
        envName: 'ALLOWED_ORIGINS',
        value: list(this.config.allowedOrigins),
      },
      {
        key: 'grpc',
        label: 'Endereço gRPC do gateway',
        envName: 'GRPC_HOST, GRPC_PORT',
        value: `${this.config.grpc.host}:${this.config.grpc.port}`,
      },
      {
        key: 'trustedProxyIps',
        label: 'Origens confiáveis da tailnet (control plane)',
        envName: 'TRUSTED_PROXY_IPS',
        value: list(this.config.tailscale.trustedProxyIps),
      },
      {
        key: 'authTrustedProxyIps',
        label: 'Proxies que podem informar o IP do cliente',
        envName: 'AUTH_TRUSTED_PROXY_IPS',
        value: list(this.config.authTrustedProxyIps),
      },
      {
        key: 'tailscaleSocket',
        label: 'Socket do tailscaled',
        envName: 'TAILSCALE_SOCKET_PATH',
        value: this.config.tailscale.socketPath,
      },
      {
        key: 'namespace',
        label: 'Namespace do Kubernetes',
        envName: 'KUBERNETES_NAMESPACE',
        value: this.config.kubernetes.namespace,
      },
    ];
  }

  private warnAboutInvalidEnvironment(): void {
    for (const definition of SETTING_DEFINITIONS) {
      for (const name of definition.envNames) {
        const raw = process.env[name];
        if (raw !== undefined && raw.trim() !== '' && !parseSetting(definition, raw).ok) {
          this.logger.warn(`Ignoring ${name}: the value is not valid for "${definition.label}".`);
        }
      }
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.logger.error(
          `A settings listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
