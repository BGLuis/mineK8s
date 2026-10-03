import { ServerSettingsPatch, UpdateServerRequest } from '../../../core/api/models';

export const MAX_SLEEP_MINUTES = 1440;

/** Mirrors UpdateDomainDto in the control plane: RFC 1123 label, 2 to 63 characters. */
const RFC1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function validateSubdomain(value: string): string | null {
  if (value === '') {
    return 'Informe um subdomínio.';
  }
  if (value.length < 2 || value.length > 63) {
    return 'Use de 2 a 63 caracteres.';
  }
  if (!RFC1123_LABEL.test(value)) {
    return 'Use só letras minúsculas, números e hífen, sem começar ou terminar com hífen.';
  }
  return null;
}

export function validateSleepMinutes(value: string): string | null {
  const text = value.trim();
  if (!/^\d+$/.test(text) || Number(text) > MAX_SLEEP_MINUTES) {
    return `Informe um número inteiro de 0 a ${MAX_SLEEP_MINUTES}.`;
  }
  return null;
}

export interface QuickSettings {
  memoryMb: number;
  sleepMinutes: string;
  subdomain: string;
  maintenance: boolean;
  autoWake: boolean;
}

export interface SettingsChanges {
  /** Goes to the real PATCH /api/servers/:id/domain. */
  domain: string | null;
  /** Goes to the real PATCH /api/servers/:id. */
  patch: UpdateServerRequest;
  /** Goes to MockApi: the backend cannot change memory after creation yet. */
  memory: ServerSettingsPatch;
}

export function diffSettings(initial: QuickSettings, current: QuickSettings): SettingsChanges {
  const patch: UpdateServerRequest = {};
  const memory: ServerSettingsPatch = {};
  if (current.memoryMb !== initial.memoryMb) {
    memory.allocated_memory_mb = current.memoryMb;
  }
  if (current.sleepMinutes.trim() !== initial.sleepMinutes.trim()) {
    patch.sleep_timeout_minutes = Number(current.sleepMinutes);
  }
  if (current.maintenance !== initial.maintenance) {
    patch.is_maintenance = current.maintenance;
  }
  if (current.autoWake !== initial.autoWake) {
    patch.auto_wake = current.autoWake;
  }
  return {
    domain: current.subdomain !== initial.subdomain ? current.subdomain : null,
    patch,
    memory,
  };
}

export function hasChanges({ domain, patch, memory }: SettingsChanges): boolean {
  return domain !== null || Object.keys(patch).length > 0 || Object.keys(memory).length > 0;
}

const POLICY_LABELS: Record<string, string> = {
  PUBLIC: 'PÚBLICO',
  GROUP: 'GRUPO',
  INDIVIDUAL: 'INDIVIDUAL',
  MAINTENANCE: 'MANUTENÇÃO',
  INTERNET: 'INTERNET',
};

export function policyLabel(policy: string): string {
  return POLICY_LABELS[policy] ?? policy;
}
