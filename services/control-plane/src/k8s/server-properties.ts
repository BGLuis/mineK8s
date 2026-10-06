import * as fs from 'node:fs';
import * as path from 'node:path';
import { MinecraftServerSettings } from '@database/entities/minecraft-server-settings.entity';

export const DEFAULT_RCON_PORT = 25575;
export const DEFAULT_RCON_PASSWORD = 'minek8s-rcon-default';

const MODPACK_SERVER_TYPES = ['FORGE', 'NEOFORGE', 'FABRIC'];

export function isModpackServerType(serverType: string): boolean {
  return MODPACK_SERVER_TYPES.includes(serverType.toUpperCase());
}

/** The port and password the control plane connects with; the server must be configured with the same pair. */
export function resolveRconCredentials(
  settings?: Pick<MinecraftServerSettings, 'rcon_port' | 'rcon_password'>,
): {
  port: number;
  password: string;
} {
  return {
    port: settings?.rcon_port || DEFAULT_RCON_PORT,
    password: settings?.rcon_password || DEFAULT_RCON_PASSWORD,
  };
}

export interface ServerPropertiesOptions {
  settings?: MinecraftServerSettings;
  isModpack: boolean;
}

/**
 * Merges the keys the control plane owns into the server's server.properties and keeps every other key.
 * RCON is always enabled: console, graceful stop and hot backup depend on it (RF-STO-14).
 */
export async function writeServerProperties(
  serverDataDir: string,
  { settings, isModpack }: ServerPropertiesOptions,
): Promise<void> {
  await fs.promises.mkdir(serverDataDir, { recursive: true });
  const propsPath = path.join(serverDataDir, 'server.properties');
  const props = await readProperties(propsPath);
  const rcon = resolveRconCredentials(settings);

  props.set('server-port', '25565');
  props.set('enable-rcon', 'true');
  props.set('rcon.port', String(rcon.port));
  props.set('rcon.password', rcon.password);
  props.set('online-mode', String(settings?.online_mode ?? false));
  props.set('enforce-secure-chat', String(settings?.enforce_secure_chat ?? false));
  // Resolução C-08: max-tick-time=-1 para modpacks, 60000 para vanilla
  props.set('max-tick-time', isModpack ? '-1' : '60000');

  if (settings) {
    props.set('motd', settings.motd);
    props.set('max-players', String(settings.max_players));
    props.set('difficulty', settings.difficulty);
    props.set('gamemode', settings.gamemode);
    props.set('hardcore', String(settings.hardcore));
    props.set('pvp', String(settings.pvp));
    props.set('spawn-protection', String(settings.spawn_protection));
    props.set('view-distance', String(settings.view_distance));
    props.set('simulation-distance', String(settings.simulation_distance));
  }

  const lines = ['# Minecraft server properties - Managed by MineKubernetes'];
  for (const [key, value] of props) {
    // A line break in a value (a motd, say) would otherwise start a new key, rcon.password included.
    lines.push(`${key}=${value.replace(/[\r\n]+/g, ' ')}`);
  }
  await fs.promises.writeFile(propsPath, `${lines.join('\n')}\n`);
}

async function readProperties(propsPath: string): Promise<Map<string, string>> {
  const props = new Map<string, string>();
  if (!fs.existsSync(propsPath)) {
    return props;
  }
  const content = await fs.promises.readFile(propsPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      props.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
    }
  }
  return props;
}
