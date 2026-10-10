import { MinecraftServerSettings, UpdateServerSettingsRequest } from '../../../core/api/models';

export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'] as const;

export const DIFFICULTY_LABELS: Record<(typeof DIFFICULTIES)[number], string> = {
  peaceful: 'Pacífico',
  easy: 'Fácil',
  normal: 'Normal',
  hard: 'Difícil',
};

export const GAMEMODE_LABELS: Record<(typeof GAMEMODES)[number], string> = {
  survival: 'Sobrevivência',
  creative: 'Criativo',
  adventure: 'Aventura',
  spectator: 'Espectador',
};

/** The form state: numbers stay as text until they are validated. */
export interface WorldSettings {
  motd: string;
  maxPlayers: string;
  difficulty: string;
  gamemode: string;
  hardcore: boolean;
  pvp: boolean;
  spawnProtection: string;
  viewDistance: string;
  simulationDistance: string;
  enforceSecureChat: boolean;
  onlineMode: boolean;
}

export type WorldSettingsErrors = Partial<Record<keyof WorldSettings, string>>;

/** The limits of MinecraftSettingsDto in the control plane. */
const MOTD_MAX_LENGTH = 255;
const MAX_PLAYERS_RANGE = [1, 1000] as const;
const DISTANCE_RANGE = [2, 32] as const;

export function toWorldSettings(settings: MinecraftServerSettings): WorldSettings {
  return {
    motd: settings.motd,
    maxPlayers: String(settings.max_players),
    difficulty: settings.difficulty,
    gamemode: settings.gamemode,
    hardcore: settings.hardcore,
    pvp: settings.pvp,
    spawnProtection: String(settings.spawn_protection),
    viewDistance: String(settings.view_distance),
    simulationDistance: String(settings.simulation_distance),
    enforceSecureChat: settings.enforce_secure_chat,
    onlineMode: settings.online_mode,
  };
}

function integerError(value: string, min: number, max?: number): string | null {
  const text = value.trim();
  if (!/^\d+$/.test(text) || Number(text) < min || (max !== undefined && Number(text) > max)) {
    return max === undefined
      ? `Informe um número inteiro a partir de ${min}.`
      : `Informe um número inteiro de ${min} a ${max}.`;
  }
  return null;
}

export function validateWorldSettings(settings: WorldSettings): WorldSettingsErrors {
  const errors: WorldSettingsErrors = {};
  const set = (key: keyof WorldSettings, error: string | null) => {
    if (error) {
      errors[key] = error;
    }
  };
  if (settings.motd.length > MOTD_MAX_LENGTH) {
    errors.motd = `Use até ${MOTD_MAX_LENGTH} caracteres.`;
  }
  set('maxPlayers', integerError(settings.maxPlayers, ...MAX_PLAYERS_RANGE));
  set('spawnProtection', integerError(settings.spawnProtection, 0));
  set('viewDistance', integerError(settings.viewDistance, ...DISTANCE_RANGE));
  set('simulationDistance', integerError(settings.simulationDistance, ...DISTANCE_RANGE));
  return errors;
}

/** Only the fields that differ, as the PATCH body. */
export function diffWorldSettings(
  initial: WorldSettings,
  current: WorldSettings,
): UpdateServerSettingsRequest {
  const patch: UpdateServerSettingsRequest = {};
  if (current.motd !== initial.motd) patch.motd = current.motd;
  if (current.maxPlayers.trim() !== initial.maxPlayers.trim()) {
    patch.max_players = Number(current.maxPlayers);
  }
  if (current.difficulty !== initial.difficulty) patch.difficulty = current.difficulty;
  if (current.gamemode !== initial.gamemode) patch.gamemode = current.gamemode;
  if (current.hardcore !== initial.hardcore) patch.hardcore = current.hardcore;
  if (current.pvp !== initial.pvp) patch.pvp = current.pvp;
  if (current.spawnProtection.trim() !== initial.spawnProtection.trim()) {
    patch.spawn_protection = Number(current.spawnProtection);
  }
  if (current.viewDistance.trim() !== initial.viewDistance.trim()) {
    patch.view_distance = Number(current.viewDistance);
  }
  if (current.simulationDistance.trim() !== initial.simulationDistance.trim()) {
    patch.simulation_distance = Number(current.simulationDistance);
  }
  if (current.enforceSecureChat !== initial.enforceSecureChat) {
    patch.enforce_secure_chat = current.enforceSecureChat;
  }
  if (current.onlineMode !== initial.onlineMode) patch.online_mode = current.onlineMode;
  return patch;
}
