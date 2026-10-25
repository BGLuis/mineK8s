import { LagDimension, LagPlayer } from './dto/lag-snapshot.dto';
import { lagFindings } from './lag-findings';

const player = (overrides: Partial<LagPlayer>): LagPlayer => ({
  nick: 'Steve',
  dimension: 'minecraft:overworld',
  position: null,
  nearbyEntities: 0,
  nearbyItems: 0,
  ...overrides,
});

const dimension = (overrides: Partial<LagDimension>): LagDimension => ({
  id: 'minecraft:overworld',
  players: ['Steve'],
  entities: null,
  items: 0,
  meanTickMs: null,
  topEntities: [],
  ...overrides,
});

describe('lagFindings', () => {
  it('flags a player from 300 nearby entities on, and not below', () => {
    expect(lagFindings([], [player({ nearbyEntities: 300 })])).toHaveLength(1);
    expect(lagFindings([], [player({ nearbyEntities: 299 })])).toEqual([]);
  });

  it('flags loose items from 200 on, and not below', () => {
    expect(lagFindings([], [player({ nearbyItems: 200 })])).toHaveLength(1);
    expect(lagFindings([], [player({ nearbyItems: 199 })])).toEqual([]);
  });

  it('flags a dimension past 60% of the 50 ms tick budget, and not below', () => {
    expect(lagFindings([dimension({ meanTickMs: 30 })], [player({})])).toHaveLength(1);
    expect(lagFindings([dimension({ meanTickMs: 29.9 })], [player({})])).toEqual([]);
  });

  it('only calls entities unattended when no player is in the dimension', () => {
    expect(lagFindings([dimension({ entities: 600, players: ['Steve'] })], [player({})])).toEqual(
      [],
    );
    expect(lagFindings([dimension({ entities: 600, players: [] })], [player({})])).toHaveLength(1);
  });

  it('needs a type to be half of the entities and at least 200 of them to call it dominant', () => {
    const topEntities = (first: number, rest: number) => [
      { type: 'minecraft:item', count: first },
      { type: 'minecraft:cow', count: rest },
    ];
    expect(
      lagFindings([dimension({ topEntities: topEntities(250, 250) })], [player({})]),
    ).toHaveLength(1);
    expect(lagFindings([dimension({ topEntities: topEntities(250, 260) })], [player({})])).toEqual(
      [],
    );
    expect(lagFindings([dimension({ topEntities: topEntities(150, 10) })], [player({})])).toEqual(
      [],
    );
  });

  it('measures dominance against every entity in the dimension, not just the listed types', () => {
    const topEntities = [
      { type: 'minecraft:item', count: 300 },
      { type: 'minecraft:cow', count: 100 },
    ];
    expect(lagFindings([dimension({ entities: 1000, topEntities })], [player({})])).toEqual([]);
  });
});
