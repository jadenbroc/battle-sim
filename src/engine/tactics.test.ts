import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  estimateDpr,
  expectedAttackDamage,
  expectedSaveDamage,
  planTurn,
  usableOptions,
  validTargets,
} from './tactics';
import { makeCombatant, makeCreature, scriptedRng } from './testUtil';
import type { AttackOption, Combatant, HealAction, SaveAction, SaveOption } from './types';

const sword: AttackOption = { name: 'Longsword', toHit: 5, damage: [{ dice: '1d8+3', type: 'slashing' }] };
const fireballSave: SaveOption = {
  name: 'Fireball',
  ability: 'dex',
  dc: 14,
  halfOnSave: true,
  damage: [{ dice: '8d6', type: 'fire' }],
};

describe('expected damage', () => {
  it('weights hit chance and crit chance for attacks', () => {
    // p = (21 - 10) / 20 = 0.55; 0.55 * 7.5 + 0.05 * 4.5
    expect(expectedAttackDamage(sword, makeCreature({ ac: 15 }))).toBeCloseTo(4.35, 5);
  });

  it('never goes below a 5% hit chance or above 95%', () => {
    expect(expectedAttackDamage(sword, makeCreature({ ac: 40 }))).toBeCloseTo(0.05 * 7.5 + 0.05 * 4.5, 5);
    expect(expectedAttackDamage(sword, makeCreature({ ac: 1 }))).toBeCloseTo(0.95 * 7.5 + 0.05 * 4.5, 5);
  });

  it('applies resistance and immunity', () => {
    const base = expectedAttackDamage(sword, makeCreature());
    expect(expectedAttackDamage(sword, makeCreature({ resistances: ['slashing'] }))).toBeCloseTo(base / 2, 5);
    expect(expectedAttackDamage(sword, makeCreature({ immunities: ['slashing'] }))).toBe(0);
  });

  it('weights save odds for save effects', () => {
    // pSave = 0.35, full = 28: 0.65 * 28 + 0.35 * 14
    expect(expectedSaveDamage(fireballSave, makeCreature())).toBeCloseTo(23.1, 5);
  });

  it('save-or-nothing effects only count failed saves', () => {
    expect(expectedSaveDamage({ ...fireballSave, halfOnSave: false }, makeCreature())).toBeCloseTo(18.2, 5);
  });

  it('estimates damage per round from the stat block', () => {
    const c = makeCombatant('m', 'enemies', { dmg: '1d6+2' });
    c.actions = [{ kind: 'attack', name: 'Multiattack', count: 2, attack: { name: 'Claw', toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } }];
    expect(estimateDpr(c)).toBe(11);
  });
});

describe('usableOptions', () => {
  const variants = [
    { name: 'Cure Wounds 1', spell: 'Cure Wounds', slotLevel: 1 },
    { name: 'Cure Wounds 2', spell: 'Cure Wounds', slotLevel: 2 },
    { name: 'Sacred Flame', slotLevel: 0 },
  ];

  it('keeps only the lowest affordable slot per spell', () => {
    expect(usableOptions(variants, { 1: 2, 2: 2 }).map((o) => o.name)).toEqual(['Cure Wounds 1', 'Sacred Flame']);
  });

  it('upcasts when lower slots are spent', () => {
    expect(usableOptions(variants, { 1: 0, 2: 1 }).map((o) => o.name)).toEqual(['Cure Wounds 2', 'Sacred Flame']);
  });

  it('falls back to free options when slots run out', () => {
    expect(usableOptions(variants, {}).map((o) => o.name)).toEqual(['Sacred Flame']);
  });
});

describe('target choice', () => {
  const rng = scriptedRng([]);
  const a = makeCombatant('a', 'enemies', { hp: 30, dmg: '1d4' });
  const b = makeCombatant('b', 'enemies', { hp: 8, dmg: '1d4' });
  const c = makeCombatant('c', 'enemies', { hp: 20, dmg: '4d10' });

  it('weakest picks the lowest current HP', () => {
    expect(chooseTarget('weakest', [a, b, c], rng)).toBe(b);
  });

  it('threat picks the highest estimated damage per round', () => {
    expect(chooseTarget('threat', [a, b, c], rng)).toBe(c);
  });

  it('random picks a valid target', () => {
    expect([a, b, c]).toContain(chooseTarget('random', [a, b, c], rng));
  });

  it('returns null with no candidates', () => {
    expect(chooseTarget('weakest', [], rng)).toBeNull();
  });

  it('only targets downed characters when no conscious one remains', () => {
    const up = makeCombatant('up', 'party');
    const down = makeCombatant('down', 'party');
    down.creature.hp = 0;
    down.creature.status = 'down';
    const dead = makeCombatant('dead', 'party');
    dead.creature.status = 'dead';
    expect(validTargets([up, down, dead])).toEqual([up]);
    expect(validTargets([down, dead])).toEqual([down]);
  });
});

describe('planTurn', () => {
  const cureWounds = (level: number): HealAction => ({ name: `Cure Wounds ${level}`, spell: 'Cure Wounds', slotLevel: level, dice: `${level}d8+3` });

  it('attacks the profile target by default', () => {
    const hero = makeCombatant('hero', 'party');
    const g1 = makeCombatant('g1', 'enemies', { hp: 7 });
    const g2 = makeCombatant('g2', 'enemies', { hp: 3 });
    const plan = planTurn(hero, [hero, g1, g2], scriptedRng([]), 3);
    expect(plan).toMatchObject({ kind: 'attack' });
    expect(plan?.kind === 'attack' && plan.target).toBe(g2);
  });

  it('heals an ally below 30% instead of attacking, downed allies first', () => {
    const cleric = makeCombatant('cleric', 'party', { heals: [cureWounds(1)], slots: { 1: 2 } });
    const low = makeCombatant('low', 'party', { hp: 20 });
    low.creature.hp = 5;
    const downed = makeCombatant('downed', 'party', { hp: 20 });
    downed.creature.hp = 0;
    downed.creature.status = 'down';
    const foe = makeCombatant('foe', 'enemies');
    const plan = planTurn(cleric, [cleric, low, downed, foe], scriptedRng([]), 3);
    expect(plan?.kind).toBe('heal');
    expect(plan?.kind === 'heal' && plan.target).toBe(downed);
  });

  it('does not heal at or above 30% HP', () => {
    const cleric = makeCombatant('cleric', 'party', { heals: [cureWounds(1)], slots: { 1: 2 } });
    const ok = makeCombatant('ok', 'party', { hp: 20 });
    ok.creature.hp = 6; // exactly 30%
    const foe = makeCombatant('foe', 'enemies');
    expect(planTurn(cleric, [cleric, ok, foe], scriptedRng([]), 3)?.kind).toBe('attack');
  });

  it('cannot heal without slots', () => {
    const cleric = makeCombatant('cleric', 'party', { heals: [cureWounds(1)], slots: { 1: 0 } });
    const low = makeCombatant('low', 'party', { hp: 20 });
    low.creature.hp = 2;
    const foe = makeCombatant('foe', 'enemies');
    expect(planTurn(cleric, [cleric, low, foe], scriptedRng([]), 3)?.kind).toBe('attack');
  });

  it('picks the higher expected damage option and falls back to cantrips when out of slots', () => {
    const area: SaveAction = { kind: 'save', name: 'Fireball', slotLevel: 3, save: fireballSave, area: true };
    const cantrip: Combatant['actions'][number] = {
      kind: 'attack',
      name: 'Fire Bolt',
      attack: { name: 'Fire Bolt', toHit: 6, damage: [{ dice: '2d10', type: 'fire' }] },
    };
    const mk = (slots: Record<number, number>): Combatant => makeCombatant('wiz', 'party', { actions: [cantrip, area], slots });
    const foes = [makeCombatant('g1', 'enemies'), makeCombatant('g2', 'enemies')];

    const withSlots = mk({ 3: 1 });
    expect(planTurn(withSlots, [withSlots, ...foes], scriptedRng([]), 3)?.kind).toBe('save');
    const empty = mk({ 3: 0 });
    expect(planTurn(empty, [empty, ...foes], scriptedRng([]), 3)?.kind).toBe('attack');
  });

  it('area spells hit up to the area limit, preferring targets with the most HP', () => {
    const area: SaveAction = { kind: 'save', name: 'Fireball', save: fireballSave, area: true };
    const wiz = makeCombatant('wiz', 'party', { actions: [area] });
    const foes = [10, 40, 25, 5].map((hp, i) => makeCombatant(`g${i}`, 'enemies', { hp }));
    const plan = planTurn(wiz, [wiz, ...foes], scriptedRng([]), 3);
    expect(plan?.kind === 'save' && plan.targets.map((t) => t.creature.hp)).toEqual([40, 25, 10]);
  });

  it('self-limiting area spells hit fewer targets', () => {
    const burning: SaveAction = { kind: 'save', name: 'Burning Hands', save: fireballSave, area: true, maxTargets: 2 };
    const wiz = makeCombatant('wiz', 'party', { actions: [burning] });
    const foes = [1, 2, 3].map((n) => makeCombatant(`g${n}`, 'enemies'));
    const plan = planTurn(wiz, [wiz, ...foes], scriptedRng([]), 3);
    expect(plan?.kind === 'save' && plan.targets).toHaveLength(2);
  });

  it('caps area targets at the living enemies', () => {
    const area: SaveAction = { kind: 'save', name: 'Fireball', save: fireballSave, area: true };
    const wiz = makeCombatant('wiz', 'party', { actions: [area] });
    const foe = makeCombatant('g', 'enemies');
    const plan = planTurn(wiz, [wiz, foe], scriptedRng([]), 3);
    expect(plan?.kind === 'save' && plan.targets).toHaveLength(1);
  });

  it('returns null when there is nothing to hit', () => {
    const hero = makeCombatant('hero', 'party');
    const foe = makeCombatant('foe', 'enemies');
    foe.creature.status = 'dead';
    foe.creature.hp = 0;
    expect(planTurn(hero, [hero, foe], scriptedRng([]), 3)).toBeNull();
  });
});
