import {
  parseConditionalCount,
  parseDimension,
  parseDimensionTickTimes,
  parsePaperEntityList,
  parsePosition,
} from './lag-output';

describe('parseConditionalCount', () => {
  it('reads the count of a passing selector', () => {
    expect(parseConditionalCount('Test passed, count: 812')).toBe(812);
  });

  it('treats a selector with no match as zero', () => {
    expect(parseConditionalCount('Test failed')).toBe(0);
    expect(parseConditionalCount('Test failed, count: 0')).toBe(0);
  });

  it('returns null for output that is not a test result', () => {
    expect(parseConditionalCount('Unknown or incomplete command, see below for error')).toBeNull();
  });
});

describe('parseDimension', () => {
  it('reads the dimension id of a player', () => {
    expect(parseDimension('Steve has the following entity data: "minecraft:the_nether"')).toBe(
      'minecraft:the_nether',
    );
  });

  it('keeps modded dimension ids', () => {
    expect(
      parseDimension('Alex has the following entity data: "twilightforest:twilight_forest"'),
    ).toBe('twilightforest:twilight_forest');
  });

  it('returns null when the player is not online', () => {
    expect(parseDimension('No entity was found')).toBeNull();
  });
});

describe('parsePosition', () => {
  it('reads the coordinates of a player', () => {
    expect(
      parsePosition('Steve has the following entity data: [120.5d, 64.0d, -3020.25d]'),
    ).toEqual({
      x: 120.5,
      y: 64,
      z: -3020.25,
    });
  });

  it('returns null when the player is not online', () => {
    expect(parsePosition('No entity was found')).toBeNull();
  });
});

describe('parsePaperEntityList', () => {
  // Line format from io.papermc.paper.command.subcommands.EntityCommand
  const output = [
    'Total Ticking: 940, Total Non-Ticking: 25',
    '  12 (3) : minecraft:pig',
    '  900 (20) : minecraft:item',
    '  28 (2) : minecraft:zombie',
    '* First number is ticking entities, second number is non-ticking entities',
  ].join('\n');

  it('adds ticking and non-ticking per type and sorts by total', () => {
    expect(parsePaperEntityList(output)).toEqual([
      { type: 'minecraft:item', count: 920 },
      { type: 'minecraft:zombie', count: 30 },
      { type: 'minecraft:pig', count: 15 },
    ]);
  });

  it('returns null when the command is missing or the world is unknown', () => {
    expect(parsePaperEntityList('Could not load world for minecraft:foo.')).toBeNull();
  });
});

describe('parseDimensionTickTimes', () => {
  it('reads NeoForge output (commands.neoforge.tps.dimension)', () => {
    const output = [
      'minecraft:overworld: 18.500 TPS (54.054 ms/tick)',
      'minecraft:the_nether: 20.000 TPS (2.100 ms/tick)',
      'Overall: 18.500 TPS (56.154 ms/tick)',
    ].join('\n');

    expect(parseDimensionTickTimes(output)).toEqual(
      new Map([
        ['minecraft:overworld', 54.054],
        ['minecraft:the_nether', 2.1],
      ]),
    );
  });

  it('reads Forge output (commands.forge.tps.summary.named), preferring the dimension name', () => {
    const output = [
      'Dim minecraft:overworld (minecraft:overworld): Mean tick time: 12.500 ms. Mean TPS: 20.000',
      'Dim 1 : Mean tick time: 0,800 ms. Mean TPS: 20,000',
      'Overall: Mean tick time: 13.300 ms. Mean TPS: 20.000',
    ].join('\n');

    expect(parseDimensionTickTimes(output)).toEqual(
      new Map([
        ['minecraft:overworld', 12.5],
        ['1', 0.8],
      ]),
    );
  });

  it('returns null when the server has no such command', () => {
    expect(parseDimensionTickTimes('Unknown or incomplete command')).toBeNull();
  });
});
