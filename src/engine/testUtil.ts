import type { Rng } from './rng';
import type { Creature } from './types';

/** An RNG that returns the given die faces in order (each clamped to the die's size). */
export function scriptedRng(faces: number[]): Rng {
  let i = 0;
  const die = (sides: number): number => {
    if (i >= faces.length) throw new Error('scriptedRng ran out of values');
    return Math.min(faces[i++]!, sides);
  };
  return {
    next: () => 0,
    int: (min) => min,
    die,
    coin: () => true,
    state: () => i,
  };
}

export function makeCreature(overrides: Partial<Creature> = {}): Creature {
  return {
    id: 'c1',
    name: 'Test',
    kind: 'character',
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveBonuses: {},
    ac: 15,
    maxHp: 20,
    hp: 20,
    status: 'alive',
    deathSaves: { successes: 0, failures: 0 },
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    ...overrides,
  };
}
