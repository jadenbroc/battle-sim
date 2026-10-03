import type { Rng } from './rng';
import type { Combatant, Creature } from './types';

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

/** A combatant with a single melee attack. Override anything via `overrides`. */
export function makeCombatant(
  id: string,
  team: Combatant['team'],
  opts: { toHit?: number; dmg?: string; hp?: number; ac?: number; dex?: number } & Partial<Combatant> = {},
): Combatant {
  const { toHit = 5, dmg = '1d8+3', hp = 20, ac = 15, dex = 10, ...rest } = opts;
  return {
    creature: makeCreature({
      id,
      name: id,
      kind: team === 'party' ? 'character' : 'monster',
      maxHp: hp,
      hp,
      ac,
      abilityScores: { str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 },
    }),
    team,
    profile: team === 'party' ? 'weakest' : 'random',
    actions: [
      {
        kind: 'attack',
        name: 'Strike',
        attack: { name: 'Strike', toHit, damage: [{ dice: dmg, type: 'slashing' }] },
      },
    ],
    heals: [],
    slots: {},
    ...rest,
  };
}
