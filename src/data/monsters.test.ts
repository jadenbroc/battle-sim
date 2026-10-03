import { describe, expect, it } from 'vitest';
import { runFight } from '../engine/fight';
import { createRng } from '../engine/rng';
import { makeCombatant } from '../engine/testUtil';
import type { MonsterDef } from './monsterTypes';
import {
  MAX_GROUP_SIZE,
  adjustGroup,
  buildEnemyGroup,
  engineActions,
  groupSize,
  monsterToCombatants,
  monsterTypes,
  notSimulated,
  searchMonsters,
} from './monsters';

function def(over: Partial<MonsterDef> = {}): MonsterDef {
  return {
    id: 'goblin-warrior',
    name: 'Goblin Warrior',
    size: 'small',
    type: 'fey',
    alignment: 'Chaotic Neutral',
    cr: '1/4',
    crValue: 0.25,
    xp: 50,
    proficiencyBonus: 2,
    ac: 15,
    hp: 10,
    hitDice: '3d6',
    abilityScores: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    saveBonuses: {},
    initiativeBonus: 0,
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    conditionImmunities: [],
    actions: [
      { kind: 'attack', name: 'Scimitar', attack: { name: 'Scimitar', toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } },
    ],
    traits: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
    otherActions: [],
    notes: [],
    ...over,
  };
}

const wolf = def({ id: 'wolf', name: 'Wolf', type: 'beast', cr: '1/4', crValue: 0.25 });
const dragon = def({ id: 'dragon', name: 'Adult Red Dragon', type: 'dragon', cr: '17', crValue: 17 });
const rat = def({ id: 'giant-rat', name: 'Giant Rat', type: 'beast', cr: '1/8', crValue: 0.125 });
const library = [def(), wolf, dragon, rat];

describe('searchMonsters', () => {
  it('matches names case-insensitively', () => {
    expect(searchMonsters(library, { query: 'RAT' }).map((m) => m.id)).toEqual(['giant-rat']);
  });

  it('filters by CR range and type', () => {
    expect(searchMonsters(library, { minCr: 0.25, maxCr: 1 }).map((m) => m.id)).toEqual(['goblin-warrior', 'wolf']);
    expect(searchMonsters(library, { type: 'beast' }).map((m) => m.id)).toEqual(['wolf', 'giant-rat']);
  });

  it('lists the distinct types', () => {
    expect(monsterTypes(library)).toEqual(['beast', 'dragon', 'fey']);
  });
});

describe('enemy groups', () => {
  it('adds, changes and removes entries', () => {
    let g = adjustGroup([], 'wolf', 2);
    expect(g).toEqual([{ id: 'wolf', count: 2 }]);
    g = adjustGroup(g, 'wolf', 1);
    expect(g).toEqual([{ id: 'wolf', count: 3 }]);
    g = adjustGroup(g, 'giant-rat', 1);
    expect(groupSize(g)).toBe(4);
    g = adjustGroup(g, 'wolf', -10);
    expect(g).toEqual([{ id: 'giant-rat', count: 1 }]);
  });

  it('never exceeds the group cap', () => {
    let g = adjustGroup([], 'wolf', 10);
    g = adjustGroup(g, 'giant-rat', 10);
    expect(groupSize(g)).toBe(MAX_GROUP_SIZE);
    expect(g.find((e) => e.id === 'giant-rat')!.count).toBe(2);
    expect(adjustGroup(g, 'dragon', 1)).toEqual(g);
  });
});

describe('monsterToCombatants', () => {
  it('numbers names and ids and copies the stat block', () => {
    const [a, b] = monsterToCombatants(def({ resistances: ['fire'], saveBonuses: { dex: 4 }, initiativeBonus: 3 }), 2);
    expect(a!.creature.name).toBe('Goblin Warrior 1');
    expect(b!.creature.id).toBe('goblin-warrior-2');
    expect(a!.creature).toMatchObject({ ac: 15, hp: 10, maxHp: 10, kind: 'monster', resistances: ['fire'], saveBonuses: { dex: 4 } });
    expect(a).toMatchObject({ team: 'enemies', profile: 'random', groupKey: 'goblin-warrior', initiativeBonus: 3 });
  });

  it('keeps the plain name for a single monster', () => {
    expect(monsterToCombatants(wolf, 1)[0]!.creature.name).toBe('Wolf');
  });

  it('gives each combatant its own copy of mutable data', () => {
    const [a, b] = monsterToCombatants(def(), 2);
    a!.creature.hp = 1;
    a!.creature.resistances = ['cold'];
    expect(b!.creature.hp).toBe(10);
    expect(b!.creature.resistances).toEqual([]);
  });
});

describe('engineActions', () => {
  const claw = { name: 'Claw', toHit: 6, damage: [{ dice: '1d6+3', type: 'slashing' as const }] };
  const bite = { name: 'Bite', toHit: 6, damage: [{ dice: '1d8+3', type: 'piercing' as const }] };
  const base = def({
    actions: [
      { kind: 'attack', name: 'Claw', attack: claw },
      { kind: 'attack', name: 'Bite', attack: bite },
    ],
  });

  it('builds a mixed multiattack as an ordered sequence', () => {
    const m = def({
      ...base,
      multiattack: { text: 'two Claw and one Bite', parts: [{ action: 'Claw', count: 2 }, { action: 'Bite', count: 1 }] },
    });
    const multi = engineActions(m).find((a) => a.name === 'Multiattack');
    expect(multi?.kind === 'attack' && multi.sequence?.map((s) => s.name)).toEqual(['Claw', 'Claw', 'Bite']);
  });

  it('picks the strongest option for an "any combination" multiattack', () => {
    const m = def({
      ...base,
      multiattack: { text: 'two attacks, using Claw or Bite', parts: [{ action: 'Claw', count: 2, options: ['Claw', 'Bite'] }] },
    });
    const multi = engineActions(m).find((a) => a.name === 'Multiattack');
    expect(multi?.kind === 'attack' && multi.sequence?.map((s) => s.name)).toEqual(['Bite', 'Bite']);
    expect(notSimulated(m).join(' ')).not.toContain('Multiattack');
  });

  it('keeps recharge and bonus actions, with their limits, for the engine to track', () => {
    const breath = {
      kind: 'save' as const,
      name: 'Breath',
      limit: { kind: 'recharge' as const, min: 5 },
      area: true,
      save: { name: 'Breath', ability: 'dex' as const, dc: 15, halfOnSave: true, damage: [{ dice: '10d6', type: 'fire' as const }] },
    };
    const m = def({ actions: [...base.actions, breath, { ...breath, name: 'Nimbus', bonus: true }] });
    const acts = engineActions(m);
    expect(acts.map((a) => a.name)).toEqual(['Claw', 'Bite', 'Breath', 'Nimbus']);
    expect(acts[2]!.limit).toEqual({ kind: 'recharge', min: 5 });
    expect(acts[3]!.bonus).toBe(true);
    expect(notSimulated(m).join(' ')).not.toContain('Breath');
  });

  it('never builds a multiattack from limited or bonus attacks', () => {
    const limited = { kind: 'attack' as const, name: 'Claw', limit: { kind: 'perDay' as const, uses: 1 }, attack: claw };
    const m = def({
      actions: [limited, { kind: 'attack', name: 'Bite', attack: bite }],
      multiattack: { text: 'two Claw attacks', parts: [{ action: 'Claw', count: 2 }] },
    });
    expect(engineActions(m).some((a) => a.name === 'Multiattack')).toBe(false);
    expect(notSimulated(m).join(' ')).toContain('Multiattack only partly simulated');
  });

  it('warns about a monster with nothing to simulate', () => {
    expect(notSimulated(def({ actions: [] })).join(' ')).toContain('No simulated attacks');
  });

  it('warns about a multiattack it cannot resolve', () => {
    const m = def({ multiattack: { text: 'two Weird attacks', parts: [{ action: 'Weird', count: 2 }] } });
    expect(notSimulated(m).join(' ')).toContain('Multiattack only partly simulated');
  });
});

describe('buildEnemyGroup', () => {
  it('builds combatants for each entry and reports unknown ids', () => {
    const { combatants, unknown } = buildEnemyGroup(library, [
      { id: 'goblin-warrior', count: 3 },
      { id: 'wolf', count: 1 },
      { id: 'nonsense', count: 1 },
    ]);
    expect(combatants.map((c) => c.creature.name)).toEqual(['Goblin Warrior 1', 'Goblin Warrior 2', 'Goblin Warrior 3', 'Wolf']);
    expect(unknown).toEqual(['nonsense']);
  });

  it('produces combatants the fight engine can run', () => {
    const { combatants } = buildEnemyGroup(library, [{ id: 'goblin-warrior', count: 2 }]);
    const hero = makeCombatant('hero', 'party', { toHit: 20, dmg: '100', hp: 50 });
    const r = runFight({ combatants: [hero, ...combatants] }, createRng('monsters'));
    expect(r.outcome).toBe('won-clean');
  });
});
