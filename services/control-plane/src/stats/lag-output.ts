/** Parsers for the console output the lag snapshot reads. Each returns null when the output is not what it expects. */

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface EntityTypeCount {
  type: string;
  count: number;
}

const ENTITY_DATA_PREFIX = /has the following entity data:\s*/;

function stripFormatting(output: string): string {
  return output.replace(/§./g, '');
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/** `execute if entity ...`: "Test passed, count: 12"; a selector with no match fails ("Test failed"). */
export function parseConditionalCount(output: string): number | null {
  const text = stripFormatting(output);
  const count = /count:\s*(\d+)/.exec(text);
  if (count) {
    return Number(count[1]);
  }
  if (/Test passed/.test(text)) {
    return 1;
  }
  return /Test failed/.test(text) ? 0 : null;
}

/** `data get entity <player> Dimension`: `Steve has the following entity data: "minecraft:the_nether"`. */
export function parseDimension(output: string): string | null {
  const [, data] = stripFormatting(output).split(ENTITY_DATA_PREFIX);
  const match = data ? /^"?([a-z0-9_.-]+:[a-z0-9_./-]+)"?/.exec(data.trim()) : null;
  return match ? match[1] : null;
}

/** `data get entity <player> Pos`: `Steve has the following entity data: [12.5d, 64.0d, -3.25d]`. */
export function parsePosition(output: string): Position | null {
  const [, data] = stripFormatting(output).split(ENTITY_DATA_PREFIX);
  const double = String.raw`(-?\d+(?:\.\d+)?(?:E-?\d+)?)d`;
  const match = data
    ? new RegExp(String.raw`^\[\s*${double}\s*,\s*${double}\s*,\s*${double}\s*\]`).exec(data.trim())
    : null;
  if (!match) {
    return null;
  }
  const [x, y, z] = match.slice(1).map(Number);
  return { x, y, z };
}

/**
 * Paper `paper entity list * <world>`: one "  10 (3) : minecraft:pig" line per type, ticking first and
 * non-ticking in parentheses.
 */
export function parsePaperEntityList(output: string): EntityTypeCount[] | null {
  const counts = [
    ...stripFormatting(output).matchAll(/^\s*(\d+)\s*\((\d+)\)\s*:\s*(\S+)\s*$/gm),
  ].map(([, ticking, nonTicking, type]) => ({ type, count: Number(ticking) + Number(nonTicking) }));
  return counts.length > 0 ? counts.sort((a, b) => b.count - a.count) : null;
}

/**
 * Mean tick time per dimension, in ms.
 * NeoForge `neoforge tps`: "minecraft:overworld: 20.000 TPS (3.512 ms/tick)".
 * Forge `forge tps`: "Dim minecraft:overworld (minecraft:overworld): Mean tick time: 3.512 ms. Mean TPS: 20.000",
 * or "Dim 0 : Mean tick time: ..." on old versions.
 */
export function parseDimensionTickTimes(output: string): Map<string, number> | null {
  const times = new Map<string, number>();
  const text = stripFormatting(output);
  for (const [, dimension, ms] of text.matchAll(
    /^\s*([a-z0-9_.-]+:[a-z0-9_./-]+):\s*[\d.,]+\s*TPS\s*\(([\d.,]+)\s*ms\/tick\)/gm,
  )) {
    times.set(dimension, toNumber(ms));
  }
  for (const [, id, name, ms] of text.matchAll(
    /Dim\s+(\S+?)(?:\s+\(([^)]+)\))?\s*:\s*Mean tick time:\s*([\d.,]+)\s*ms/g,
  )) {
    times.set(name ?? id, toNumber(ms));
  }
  return times.size > 0 ? times : null;
}
