import { MinecraftServerSettings } from '../../../core/api/models';
import {
  WorldSettings,
  diffWorldSettings,
  toWorldSettings,
  validateWorldSettings,
} from './world-settings';

const SERVER_SETTINGS: MinecraftServerSettings = {
  motd: 'A MineKubernetes Server',
  max_players: 20,
  difficulty: 'normal',
  gamemode: 'survival',
  hardcore: false,
  pvp: true,
  spawn_protection: 16,
  view_distance: 10,
  simulation_distance: 10,
  enable_rcon: true,
  rcon_port: 25575,
  enforce_secure_chat: false,
  online_mode: false,
  language: 'pt-BR',
};

const INITIAL: WorldSettings = toWorldSettings(SERVER_SETTINGS);

describe('toWorldSettings', () => {
  it('keeps numbers as text for the inputs and leaves RCON out of the form', () => {
    expect(INITIAL).toEqual({
      motd: 'A MineKubernetes Server',
      maxPlayers: '20',
      difficulty: 'normal',
      gamemode: 'survival',
      hardcore: false,
      pvp: true,
      spawnProtection: '16',
      viewDistance: '10',
      simulationDistance: '10',
      enforceSecureChat: false,
      onlineMode: false,
      language: 'pt-BR',
    });
  });
});

describe('validateWorldSettings', () => {
  it('accepts the settings the server already has', () => {
    expect(validateWorldSettings(INITIAL)).toEqual({});
  });

  it.each([
    ['maxPlayers', '0'],
    ['maxPlayers', '1001'],
    ['maxPlayers', 'dez'],
    ['spawnProtection', '-1'],
    ['viewDistance', '1'],
    ['viewDistance', '33'],
    ['simulationDistance', '1.5'],
    ['simulationDistance', ''],
  ] as const)('rejects %s = "%s"', (field, value) => {
    expect(validateWorldSettings({ ...INITIAL, [field]: value })[field]).toBeDefined();
  });

  it('accepts the limits of the control plane', () => {
    const edges = { ...INITIAL, maxPlayers: '1000', viewDistance: '2', simulationDistance: '32' };
    expect(validateWorldSettings(edges)).toEqual({});
  });

  it('rejects a MOTD longer than 255 characters', () => {
    expect(validateWorldSettings({ ...INITIAL, motd: 'x'.repeat(256) }).motd).toBeDefined();
  });
});

describe('diffWorldSettings', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffWorldSettings(INITIAL, { ...INITIAL })).toEqual({});
  });

  it('sends only the changed fields, with the names and types of the API', () => {
    const patch = diffWorldSettings(INITIAL, {
      ...INITIAL,
      motd: 'Bem-vindo',
      maxPlayers: '8',
      pvp: false,
      onlineMode: true,
      language: 'en',
    });

    expect(patch).toEqual({
      motd: 'Bem-vindo',
      max_players: 8,
      pvp: false,
      online_mode: true,
      language: 'en',
    });
  });
});
