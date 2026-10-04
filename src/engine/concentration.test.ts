import { describe, expect, it } from 'vitest';
import { viewAt } from '../ui/replay';
import { performAttack, performSave } from './combat';
import { addRollMod, concentrationDc, rollModAverage, tickRollMods } from './concentration';
import { runFight, type LoggedEvent } from './fight';
import { createRng } from './rng';
import { planTurn } from './tactics';
import { makeCombatant, makeCreature, scriptedRng } from './testUtil';
import type { Action, BuffAction, Combatant, SaveAction } from './types';

const BANE = { dice: '1d4', sign: -1 as const, attacks: true, saves: true, rounds: 10 };

const holdSpell = (over: Partial<SaveAction> = {}): SaveAction => ({
  kind: 'save',
  name: 'Blind',
  spell: 'Blind',
  concentration: true,
  area: true,
  maxTargets: 1,
  save: {
    name: 'Blind',
    ability: 'wis',
    dc: 99,
    halfOnSave: false,
    damage: [],
    effects: [{ condition: 'blinded', duration: { kind: 'rounds', n: 10 } }],
    concentration: true,
  },
  ...over,
});

const baneAction = (): SaveAction => ({
  kind: 'save',
  name: 'Bane',
  spell: 'Bane',
  concentration: true,
  area: true,
  maxTargets: 3,
  save: { name: 'Bane', ability: 'cha', dc: 15, halfOnSave: false, damage: [], rollModifier: BANE, concentration: true },
});

const events = (log: LoggedEvent[], kind: string) => log.filter((l) => l.event.kind === kind).map((l) => l.event);

describe('concentration saves', () => {
  it('uses DC 10 or half the damage, at most 30', () => {
    expect(concentrationDc(4)).toBe(10);
    expect(concentrationDc(21)).toBe(10);
    expect(concentrationDc(30)).toBe(15);
    expect(concentrationDc(200)).toBe(30);
  });
});

/** A caster that concentrates on Blind against a blind-able foe, while another foe hits the caster. */
function setup(casterHp: number): { caster: Combatant; foes: Combatant[] } {
  const caster = makeCombatant('mage', 'party', { hp: casterHp, ac: 1, dex: 30 });
  caster.actions = [holdSpell()];
  caster.creature.saveBonuses = { con: -50 };
  const target = makeCombatant('target', 'enemies', { hp: 500, dmg: '0', toHit: -10, dex: 1 });
  const striker = makeCombatant('striker', 'enemies', { hp: 500, dmg: '4', toHit: 50, dex: 1 });
  return { caster, foes: [target, striker] };
}

describe('concentrating in a fight', () => {
  it('starts when the spell is cast and ends, with its effects, when the save fails', () => {
    const { caster, foes } = setup(500);
    // Make the spell hit the target, not the striker.
    foes[1]!.creature.saveBonuses = { wis: 100 };
    foes[0]!.creature.saveBonuses = { wis: -100 };
    foes[1]!.creature.hp = 400; // an area spell prefers the enemy with the most HP: the target
    const config = { combatants: [caster, ...foes] };
    const { log } = runFight(config, createRng('c1'), { log: true });

    const start = events(log, 'concentration-start')[0];
    expect(start).toMatchObject({ actor: 'mage', spell: 'Blind' });
    const end = events(log, 'concentration-end')[0];
    expect(end).toMatchObject({ actor: 'mage', spell: 'Blind', reason: 'failed-save' });
    expect(end!.kind === 'concentration-end' && end.released).toEqual([{ target: 'target', condition: 'blinded' }]);
    expect(events(log, 'concentration-check').length).toBeGreaterThan(0);
    // The log replay agrees: the target is no longer blinded at the end.
    const view = viewAt(config, log, log.length).find((v) => v.name === 'target')!;
    expect(view.conditions).not.toContain('blinded');
  });

  it('ends without a save when the caster is knocked out', () => {
    const { caster, foes } = setup(3);
    foes[1]!.creature.hp = 400;
    foes[0]!.creature.saveBonuses = { wis: -100 };
    foes[1]!.creature.saveBonuses = { wis: 100 };
    const { log } = runFight({ combatants: [caster, ...foes] }, createRng('c2'), { log: true });
    const end = events(log, 'concentration-end')[0];
    expect(end).toMatchObject({ reason: 'down' });
  });

  it('does not start a second concentration spell, but still uses other actions', () => {
    const cantrip: Action = { kind: 'attack', name: 'Zap', attack: { name: 'Zap', toHit: 5, damage: [{ dice: '1d4', type: 'fire' }] } };
    const caster = makeCombatant('mage', 'party', {});
    caster.actions = [holdSpell(), cantrip];
    const foe = makeCombatant('foe', 'enemies', {});
    const plan = (): string | undefined => planTurn(caster, [caster, foe], createRng('p'), 3)?.action.name;
    caster.creature.concentrating = 'Something';
    expect(plan()).toBe('Zap');
    caster.actions = [holdSpell()];
    expect(plan()).toBeUndefined();
    delete caster.creature.concentrating;
    expect(plan()).toBe('Blind');
  });
});

describe('roll modifiers (Bane)', () => {
  it('subtracts the die from the target attack rolls', () => {
    const attacker = makeCreature({ id: 'a', name: 'a' });
    const target = makeCreature({ id: 't', name: 't', ac: 10 });
    const opt = { name: 'Hit', toHit: 5, damage: [{ dice: '1', type: 'slashing' as const }] };
    addRollMod(attacker, BANE, 'Bane', 'caster', false);
    // The penalty die rolls first (4), then the d20.
    expect(performAttack(scriptedRng([4, 12]), attacker, opt, target).attackRoll.hit).toBe(true); // 12 + 5 - 4 = 13
    expect(performAttack(scriptedRng([4, 8]), attacker, opt, target).attackRoll.hit).toBe(false); // 8 + 5 - 4 = 9
  });

  it('is put on a target that fails the save, and not on one that passes', () => {
    const caster = makeCreature({ id: 'c', name: 'c' });
    const opt = baneAction().save;
    const failed = makeCreature({ id: 't1', name: 't1' });
    const e1 = performSave(scriptedRng([1]), caster, opt, failed);
    expect(e1.marked).toEqual(['Bane']);
    expect(failed.rollMods).toHaveLength(1);
    const passed = makeCreature({ id: 't2', name: 't2' });
    const e2 = performSave(scriptedRng([20]), caster, opt, passed);
    expect(e2.marked).toBeUndefined();
    expect(passed.rollMods).toBeUndefined();
  });

  it('applies to saving throws as well, and wears off', () => {
    const c = makeCreature({ id: 't', name: 't' });
    addRollMod(c, { ...BANE, rounds: 2 }, 'Bane', 'caster', false);
    expect(rollModAverage(c, 'save')).toBe(-2.5);
    expect(rollModAverage(c, 'attack')).toBe(-2.5);
    expect(tickRollMods([c])).toEqual([]);
    expect(tickRollMods([c])).toEqual([{ target: 't', condition: 'Bane' }]);
    expect(rollModAverage(c, 'save')).toBe(0);
  });

  it('ends with the caster concentration and shows in the replay', () => {
    const caster = makeCombatant('cleric', 'party', { hp: 500, ac: 1, dex: 30 });
    caster.actions = [baneAction()];
    caster.creature.saveBonuses = { con: -50 };
    const goblins = [1, 2, 3].map((i) => makeCombatant(`gob${i}`, 'enemies', { hp: 500, dmg: '4', toHit: 50, dex: 1 }));
    for (const g of goblins) g.creature.saveBonuses = { cha: -100 };
    const config = { combatants: [caster, ...goblins] };
    const { log } = runFight(config, createRng('bane'), { log: true });

    const saves = events(log, 'save');
    expect(saves.length).toBeGreaterThanOrEqual(3);
    expect(saves.slice(0, 3).every((e) => e.kind === 'save' && e.marked?.[0] === 'Bane')).toBe(true);
    const end = events(log, 'concentration-end')[0];
    expect(end!.kind === 'concentration-end' && end.released.map((r) => r.condition)).toEqual(['Bane', 'Bane', 'Bane']);
    const views = viewAt(config, log, log.length);
    expect(views.filter((v) => v.conditions.includes('Bane'))).toEqual([]);
  });
});

describe('valuing a roll penalty', () => {
  const cantrip = (): Action => ({ kind: 'attack', name: 'Zap', attack: { name: 'Zap', toHit: 5, damage: [{ dice: '1d4', type: 'fire' }] } });
  const goblins = (): Combatant[] =>
    [1, 2, 3].map((i) => {
      const g = makeCombatant(`gob${i}`, 'enemies', { dmg: '1d6+2', ac: 15 });
      return g;
    });

  it('casts Bane over a weak cantrip against several enemies that hit hard', () => {
    const cleric = makeCombatant('cleric', 'party', {});
    cleric.actions = [cantrip(), baneAction()];
    const foes = goblins();
    const plan = planTurn(cleric, [cleric, ...foes], createRng('v'), 3);
    expect(plan?.action.name).toBe('Bane');
    expect(plan?.kind === 'save' && plan.targets).toHaveLength(3);
  });

  it('does not recast it on targets that already have it', () => {
    const cleric = makeCombatant('cleric', 'party', {});
    cleric.actions = [cantrip(), baneAction()];
    const foes = goblins();
    for (const g of foes) addRollMod(g.creature, BANE, 'Bane', cleric.creature.id, true);
    expect(planTurn(cleric, [cleric, ...foes], createRng('v'), 3)?.action.name).toBe('Zap');
  });
});

describe('buffs (Bless)', () => {
  const BLESS = { dice: '1d4', sign: 1 as const, attacks: true, saves: true, rounds: 10 };
  const blessAction = (maxTargets = 3): BuffAction => ({ name: 'Bless', spell: 'Bless', concentration: true, rollModifier: BLESS, maxTargets });
  const cantrip = (): Action => ({ kind: 'attack', name: 'Zap', attack: { name: 'Zap', toHit: 5, damage: [{ dice: '1d4', type: 'fire' }] } });
  const party = (): Combatant[] => {
    const cleric = makeCombatant('cleric', 'party', { hp: 500, ac: 1 });
    cleric.actions = [cantrip()];
    cleric.buffs = [blessAction()];
    const fighter = makeCombatant('fighter', 'party', { dmg: '1d8+4' });
    const rogue = makeCombatant('rogue', 'party', { dmg: '1d6+3' });
    const wizard = makeCombatant('wizard', 'party', { dmg: '1d4' });
    return [cleric, fighter, rogue, wizard];
  };
  const foe = (): Combatant => makeCombatant('foe', 'enemies', { hp: 500, dmg: '0', toHit: -10 });

  it('adds the die to the roll of a blessed attacker', () => {
    const attacker = makeCreature({ id: 'a', name: 'a' });
    const target = makeCreature({ id: 't', name: 't', ac: 10 });
    const opt = { name: 'Hit', toHit: 5, damage: [{ dice: '1', type: 'slashing' as const }] };
    addRollMod(attacker, BLESS, 'Bless', 'cleric', true);
    expect(performAttack(scriptedRng([2, 4]), attacker, opt, target).attackRoll.hit).toBe(true); // 4 + 5 + 2 = 11
    expect(rollModAverage(attacker, 'attack')).toBe(2.5);
  });

  it('is cast on the strongest allies in preference to a weak cantrip, then the cleric concentrates', () => {
    const [cleric, ...others] = party();
    const plan = planTurn(cleric!, [cleric!, ...others, foe()], createRng('b'), 3);
    expect(plan?.kind).toBe('buff');
    const names = plan?.kind === 'buff' ? plan.targets.map((t) => t.creature.name) : [];
    expect(names).toHaveLength(3);
    expect(names).toContain('fighter');
    expect(names).not.toContain('wizard'); // the weakest damage dealer is left out
    cleric!.creature.concentrating = 'Bless';
    expect(planTurn(cleric!, [cleric!, ...others, foe()], createRng('b'), 3)?.kind).toBe('attack');
  });

  it('is not cast again on those who already have it', () => {
    const [cleric, ...others] = party();
    for (const o of [cleric!, ...others]) addRollMod(o.creature, BLESS, 'Bless', cleric!.creature.id, true);
    expect(planTurn(cleric!, [cleric!, ...others, foe()], createRng('b'), 3)?.kind).toBe('attack');
  });

  it('is cast in a fight, shows in the replay, and ends with the concentration', () => {
    const [cleric, ...others] = party();
    cleric!.creature.saveBonuses = { con: -50 };
    const striker = makeCombatant('striker', 'enemies', { hp: 500, dmg: '4', toHit: 50, dex: 1 });
    const config = { combatants: [cleric!, ...others, striker] };
    const { log } = runFight(config, createRng('bless'), { log: true });
    const casts = events(log, 'buff');
    expect(casts.length).toBeGreaterThanOrEqual(3); // the cleric recasts after losing it, on whoever is still up
    expect(casts[0]).toMatchObject({ actor: 'cleric', option: 'Bless' });
    expect(events(log, 'concentration-start')[0]).toMatchObject({ spell: 'Bless' });
    const end = events(log, 'concentration-end')[0];
    expect(end!.kind === 'concentration-end' && end.released.map((r) => r.condition)).toEqual(['Bless', 'Bless', 'Bless']); // the first cast: three allies
    expect(viewAt(config, log, log.length).filter((v) => v.conditions.includes('Bless'))).toEqual([]);
    const midway = viewAt(config, log, log.findIndex((l) => l.event.kind === 'concentration-end'));
    expect(midway.filter((v) => v.conditions.includes('Bless'))).toHaveLength(3);
  });
});
