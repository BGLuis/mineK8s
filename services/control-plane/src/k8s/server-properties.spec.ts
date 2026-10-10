import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';
import {
  DEFAULT_RCON_PASSWORD,
  DEFAULT_RCON_PORT,
  escapeMotd,
  resolveRconCredentials,
  writeServerProperties,
} from './server-properties';

describe('writeServerProperties (#153)', () => {
  let dir: string;
  let settings: MinecraftServerSettings;

  const readProps = (): Map<string, string> =>
    new Map(
      fs
        .readFileSync(path.join(dir, 'server.properties'), 'utf-8')
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-properties-'));
    settings = {
      motd: 'A MineKubernetes Server',
      max_players: 30,
      difficulty: 'hard',
      gamemode: 'creative',
      hardcore: true,
      pvp: false,
      spawn_protection: 4,
      view_distance: 12,
      simulation_distance: 8,
      rcon_port: 25576,
      rcon_password: 'abc123',
      enforce_secure_chat: false,
      online_mode: false,
    } as MinecraftServerSettings;
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('desliga a whitelist do Minecraft: quem entra é decidido pelo gateway, e o vanilla 26.x a liga por padrão', async () => {
    fs.writeFileSync(
      path.join(dir, 'server.properties'),
      'white-list=true\nenforce-whitelist=true\n',
    );

    await writeServerProperties(dir, { settings, isModpack: false });

    const props = readProps();
    expect(props.get('white-list')).toBe('false');
    expect(props.get('enforce-whitelist')).toBe('false');
  });

  it('liga o RCON com a mesma porta e senha que o pool usa para conectar', async () => {
    await writeServerProperties(dir, { settings, isModpack: false });

    const props = readProps();
    const rcon = resolveRconCredentials(settings);
    expect(props.get('enable-rcon')).toBe('true');
    expect(props.get('rcon.port')).toBe(String(rcon.port));
    expect(props.get('rcon.password')).toBe(rcon.password);
  });

  it('sem settings usa as mesmas credenciais padrão do pool', async () => {
    await writeServerProperties(dir, { isModpack: false });

    const props = readProps();
    expect(props.get('rcon.port')).toBe(String(DEFAULT_RCON_PORT));
    expect(props.get('rcon.password')).toBe(DEFAULT_RCON_PASSWORD);
  });

  it('aplica os minecraft_settings', async () => {
    await writeServerProperties(dir, { settings, isModpack: false });

    const props = readProps();
    expect(Object.fromEntries(props)).toMatchObject({
      motd: 'A MineKubernetes Server',
      'max-players': '30',
      difficulty: 'hard',
      gamemode: 'creative',
      hardcore: 'true',
      pvp: 'false',
      'spawn-protection': '4',
      'view-distance': '12',
      'simulation-distance': '8',
    });
  });

  it('mantém as chaves que o sistema não controla e sobrescreve as controladas', async () => {
    fs.writeFileSync(
      path.join(dir, 'server.properties'),
      '#comentário\nlevel-seed=12345\nallow-flight=true\nenable-rcon=false\nrcon.password=velha\n',
    );

    await writeServerProperties(dir, { settings, isModpack: false });

    const props = readProps();
    expect(props.get('level-seed')).toBe('12345');
    expect(props.get('allow-flight')).toBe('true');
    expect(props.get('enable-rcon')).toBe('true');
    expect(props.get('rcon.password')).toBe('abc123');
  });

  it('online-mode segue minecraft_settings (RF-CF-02) e é false sem settings', async () => {
    await writeServerProperties(dir, {
      settings: { ...settings, online_mode: true },
      isModpack: false,
    });
    expect(readProps().get('online-mode')).toBe('true');

    await writeServerProperties(dir, { isModpack: false });
    expect(readProps().get('online-mode')).toBe('false');
  });

  it('desliga o max-tick-time só para modpacks (C-08)', async () => {
    await writeServerProperties(dir, { settings, isModpack: true });
    expect(readProps().get('max-tick-time')).toBe('-1');

    await writeServerProperties(dir, { settings, isModpack: false });
    expect(readProps().get('max-tick-time')).toBe('60000');
  });

  it('quebra de linha num valor não cria uma chave nova', async () => {
    await writeServerProperties(dir, {
      settings: { ...settings, motd: 'oi\nrcon.password=roubada' },
      isModpack: false,
    });

    const props = readProps();
    expect(props.get('rcon.password')).toBe('abc123');
    // The break is kept for the MOTD's second line, as an escape that stays on the same line.
    expect(props.get('motd')).toBe('oi\\nrcon.password=roubada');
  });
});

describe('escapeMotd', () => {
  it('turns a line break, typed or real, into the escape the server reads as a second line', () => {
    expect(escapeMotd('Sekiro\\nBom jogo')).toBe('Sekiro\\nBom jogo');
    expect(escapeMotd('Sekiro\nBom jogo')).toBe('Sekiro\\nBom jogo');
    expect(escapeMotd('Sekiro\r\nBom jogo')).toBe('Sekiro\\nBom jogo');
  });

  it('writes the colour sign and accents as unicode escapes, readable whatever the file encoding', () => {
    expect(escapeMotd('§aOlá')).toBe('\\u00a7aOl\\u00e1');
  });

  it('keeps a backslash from escaping what follows it', () => {
    expect(escapeMotd('a\\b')).toBe('a\\\\b');
  });

  it('leaves plain text as it is', () => {
    expect(escapeMotd('Bem-vindo ao mundo!')).toBe('Bem-vindo ao mundo!');
  });
});

describe('o MOTD no server.properties', () => {
  it('chega ao arquivo em duas linhas, com cores, sem depender da codificação', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motd-'));
    try {
      await writeServerProperties(dir, {
        settings: {
          motd: '§a§lSekiro\\n§7Entre e bom jogo!',
          max_players: 20,
          difficulty: 'normal',
          gamemode: 'survival',
          hardcore: false,
          pvp: true,
          spawn_protection: 16,
          view_distance: 10,
          simulation_distance: 10,
          rcon_port: 25575,
          rcon_password: 'abc123',
          enforce_secure_chat: false,
          online_mode: false,
        } as MinecraftServerSettings,
        isModpack: false,
      });

      const file = fs.readFileSync(path.join(dir, 'server.properties'), 'utf-8');
      expect(file).toContain('motd=\\u00a7a\\u00a7lSekiro\\n\\u00a77Entre e bom jogo!');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
