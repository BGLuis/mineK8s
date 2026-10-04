import { HttpErrorResponse } from '@angular/common/http';

import {
  CreateServerRequest,
  Modpack,
  ModpackVersion,
  ServerAccessPolicy,
  ServerType,
  TaskProgress,
} from '../../core/api/models';
import { IconName } from '../../ui';

export type ProfileChoice = ServerType | 'MODPACK';

export type WizardAccessPolicy = Extract<ServerAccessPolicy, 'PUBLIC' | 'GROUP' | 'INDIVIDUAL'>;

export const STEP_LABELS = ['Perfil', 'Recursos', 'Rede', 'Provisionar'];

export const DEFAULT_GAME_VERSION = '1.21.1';
export const MEMORY_MIN_MB = 1024;
export const MEMORY_MAX_MB = 65536;
export const SLEEP_MAX_MINUTES = 1440;
export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const SUBDOMAIN_MIN = 2;
export const SUBDOMAIN_MAX = 63;
export const MESH_DOMAIN = 'mine.internal';

/** Same pattern as CreateServerDto.subdomain on the control plane. */
const RFC1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export interface ProfileOption {
  value: ProfileChoice;
  label: string;
  description: string;
  icon: IconName;
}

export const PROFILE_OPTIONS: readonly ProfileOption[] = [
  { value: 'VANILLA', label: 'Vanilla', description: 'Oficial da Mojang', icon: 'grid' },
  { value: 'PAPER', label: 'Paper', description: 'Plugins e desempenho', icon: 'sword' },
  { value: 'PURPUR', label: 'Purpur', description: 'Paper com mais ajustes', icon: 'settings' },
  { value: 'FABRIC', label: 'Fabric', description: 'Mods leves', icon: 'plant' },
  { value: 'FORGE', label: 'Forge', description: 'Mods clássicos', icon: 'pickaxe' },
  { value: 'NEOFORGE', label: 'NeoForge', description: 'Mods modernos', icon: 'hook' },
  { value: 'MODPACK', label: 'Modpack', description: 'Modrinth ou CurseForge', icon: 'list' },
];

export interface AccessOption {
  value: WizardAccessPolicy;
  label: string;
  description: string;
}

export const ACCESS_OPTIONS: readonly AccessOption[] = [
  {
    value: 'PUBLIC',
    label: 'Público',
    description: 'Qualquer dispositivo da rede Tailscale entra.',
  },
  { value: 'GROUP', label: 'Grupo', description: 'Só os grupos autorizados entram.' },
  {
    value: 'INDIVIDUAL',
    label: 'Individual',
    description: 'Só jogadores liberados um a um entram.',
  },
];

export interface WizardState {
  profile: ProfileChoice | null;
  gameVersion: string;
  modpack: Modpack | null;
  modpackVersion: ModpackVersion | null;
  memoryMb: number;
  sleepTimeoutMinutes: number;
  autoWake: boolean;
  name: string;
  subdomain: string;
  accessPolicy: WizardAccessPolicy;
}

export function initialWizardState(): WizardState {
  return {
    profile: null,
    gameVersion: DEFAULT_GAME_VERSION,
    modpack: null,
    modpackVersion: null,
    memoryMb: 4096,
    sleepTimeoutMinutes: 15,
    autoWake: true,
    name: '',
    subdomain: '',
    accessPolicy: 'GROUP',
  };
}

const LOADER_TO_SERVER_TYPE: Record<string, ServerType> = {
  fabric: 'FABRIC',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
};

/** Modpack versions carry the loader as free text; only loaders the control plane can run map to a ServerType. */
export function loaderToServerType(loader: string): ServerType | null {
  return LOADER_TO_SERVER_TYPE[loader.trim().toLowerCase()] ?? null;
}

export function slugifySubdomain(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX);
}

export function validateSubdomain(value: string): string | null {
  if (value.length < SUBDOMAIN_MIN || value.length > SUBDOMAIN_MAX) {
    return `O endereço deve ter de ${SUBDOMAIN_MIN} a ${SUBDOMAIN_MAX} caracteres.`;
  }
  if (!RFC1123_LABEL.test(value)) {
    return 'Use só letras minúsculas, números e hífens, sem começar nem terminar com hífen.';
  }
  return null;
}

export type StepErrors = Record<string, string>;

export function validateProfile(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  if (!state.profile) {
    errors['profile'] = 'Escolha o tipo de servidor.';
    return errors;
  }
  if (state.profile === 'MODPACK') {
    if (!state.modpack) {
      errors['modpack'] = 'Escolha um modpack.';
    } else if (!state.modpackVersion) {
      errors['modpackVersion'] = 'Escolha a versão do modpack.';
    } else if (!loaderToServerType(state.modpackVersion.loader)) {
      errors['modpackVersion'] =
        `O loader "${state.modpackVersion.loader}" ainda não é suportado. Escolha outra versão.`;
    }
  } else if (state.gameVersion.trim() === '') {
    errors['gameVersion'] = 'Informe a versão do Minecraft.';
  }
  return errors;
}

export function validateResources(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  if (
    !Number.isInteger(state.memoryMb) ||
    state.memoryMb < MEMORY_MIN_MB ||
    state.memoryMb > MEMORY_MAX_MB
  ) {
    errors['memory'] = `A memória deve ficar entre ${MEMORY_MIN_MB} e ${MEMORY_MAX_MB} MB.`;
  }
  if (
    !Number.isInteger(state.sleepTimeoutMinutes) ||
    state.sleepTimeoutMinutes < 0 ||
    state.sleepTimeoutMinutes > SLEEP_MAX_MINUTES
  ) {
    errors['sleep'] = `A hibernação deve ficar entre 0 e ${SLEEP_MAX_MINUTES} minutos.`;
  }
  return errors;
}

export function validateNetwork(state: WizardState): StepErrors {
  const errors: StepErrors = {};
  const name = state.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors['name'] = `O nome deve ter de ${NAME_MIN} a ${NAME_MAX} caracteres.`;
  }
  const subdomainError = validateSubdomain(state.subdomain);
  if (subdomainError) {
    errors['subdomain'] = subdomainError;
  }
  return errors;
}

export const STEP_VALIDATORS: readonly ((state: WizardState) => StepErrors)[] = [
  validateProfile,
  validateResources,
  validateNetwork,
];

export function buildCreateServerDto(state: WizardState): CreateServerRequest {
  const base = {
    name: state.name.trim(),
    subdomain: state.subdomain,
    allocated_memory_mb: state.memoryMb,
    sleep_timeout_minutes: state.sleepTimeoutMinutes,
    auto_wake: state.autoWake,
    access_policy: state.accessPolicy,
  };

  if (state.profile === 'MODPACK' && state.modpack && state.modpackVersion) {
    return {
      ...base,
      server_type: loaderToServerType(state.modpackVersion.loader) ?? undefined,
      game_version: state.modpackVersion.gameVersion,
      modpack_id: state.modpack.id,
    };
  }
  return {
    ...base,
    server_type: state.profile === 'MODPACK' ? undefined : (state.profile ?? undefined),
    game_version: state.gameVersion.trim(),
  };
}

export function profileLabel(state: WizardState): string {
  return PROFILE_OPTIONS.find((option) => option.value === state.profile)?.label ?? '';
}

/* ------------------------------------------------------------ provisioning */

export type ProvisioningStepState = 'done' | 'current' | 'pending' | 'failed';

export interface ProvisioningStep {
  status: string;
  label: string;
  state: ProvisioningStepState;
}

const PROVISIONING_FLOW = [
  { status: 'QUEUED', label: 'Na fila' },
  { status: 'RESOLVING', label: 'Resolvendo dependências' },
  { status: 'DOWNLOADING', label: 'Baixando arquivos' },
  { status: 'APPLYING_OVERRIDES', label: 'Aplicando overrides' },
  { status: 'COMPLETED', label: 'Concluído' },
] as const;

/**
 * Maps the task status to the checklist. FAILED does not say which step failed, so the
 * `lastStatus` seen before it marks the failing row.
 */
export function provisioningSteps(status: string, lastStatus = 'QUEUED'): ProvisioningStep[] {
  const failed = status === 'FAILED';
  const reference = failed ? lastStatus : status;
  const index = PROVISIONING_FLOW.findIndex((step) => step.status === reference);
  const current = index === -1 ? 0 : index;

  return PROVISIONING_FLOW.map((step, i) => {
    let state: ProvisioningStepState;
    if (status === 'COMPLETED' || i < current) {
      state = 'done';
    } else if (i === current) {
      state = failed ? 'failed' : 'current';
    } else {
      state = 'pending';
    }
    return { status: step.status, label: `${step.label} (${step.status})`, state };
  });
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) {
    return '';
  }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSec;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function progressStepText(progress: TaskProgress | null): string {
  if (!progress) {
    return 'Aguardando o início da instalação…';
  }
  const parts = [progress.currentStep];
  if (progress.totalFiles > 0) {
    parts.push(`${progress.downloadedFiles} de ${progress.totalFiles} arquivos`);
  }
  const speed = formatSpeed(progress.speedBytesPerSec);
  if (speed) {
    parts.push(speed);
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ errors */

/** Extracts the readable message from a NestJS error body, which may be a string or a list. */
export function apiMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const message = (error.error as { message?: string | string[] } | null)?.message;
  if (Array.isArray(message)) {
    return message.join(' ');
  }
  return typeof message === 'string' ? message : null;
}

export function createServerErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 409) {
      return 'Esse endereço já está em uso. Volte à etapa Rede e escolha outro.';
    }
    if (error.status === 400) {
      return apiMessage(error) ?? 'Os dados informados foram recusados pelo servidor.';
    }
    if (error.status === 0) {
      return 'Não foi possível falar com o painel. Verifique sua conexão e tente de novo.';
    }
  }
  return 'Não foi possível criar o servidor. Tente novamente.';
}

export function installErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 409) {
    return 'O servidor precisa estar parado para instalar o modpack.';
  }
  return 'Não foi possível iniciar a instalação do modpack. Tente novamente.';
}
