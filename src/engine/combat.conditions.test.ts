import { describe, expect, it } from 'vitest';
import { performAttack, performSave } from './combat';
import { makeCreature, scriptedRng } from './testUtil';
import type { ActiveCondition, AttackOption, ConditionName, Creature, SaveOption } from './types';

const withCond = (names: ConditionName[], over: Partial<Creature> = {}): Creature =>
  makeCreature({ conditions: names.map((name): ActiveCondition => ({ name, duration: { kind: 'indefinite' } })), ...over });

const sword: AttackOption = { name: 'Sword', toHit: 5, damage: [{ dice: '1d8+3', type: 'slashing' }] };
const bow: AttackOption = { ...sword, name: 'Bow', range: 'ranged' };
const fireball: SaveOption = { name: 'Fireball', ability: 'dex', dc: 14, halfOnSave: true, damage: [{ dice: '8d6', type: 'fire' }] };

describe('attacks and conditions', () => {
  it('melee attacks on a Prone target have advantage, ranged ones disadvantage', () => {
    const target = withCond(['prone'], { ac: 5, hp: 100, maxHp: 100 });
    const melee = performAttack(scriptedRng([3, 18, 4]), makeCreature(), sword, target);
    expect(melee.mode).toBe('advantage');
    expect(melee.attackRoll.roll.rolls).toEqual([3, 18]);
    const ranged = performAttack(scriptedRng([18, 3, 4]), makeCreature(), bow, target);
    expect(ranged.mode).toBe('disadvantage');
    expect(ranged.attackRoll.roll.natural).toBe(3);
  });

  it('a Poisoned attacker rolls with disadvantage', () => {
    const e = performAttack(scriptedRng([18, 3]), withCond(['poisoned']), sword, makeCreature({ ac: 20 }));
    expect(e.mode).toBe('disadvantage');
    expect(e.attackRoll.hit).toBe(false);
  });

  it('advantage and disadvantage from different sources cancel', () => {
    const e = performAttack(scriptedRng([15, 1]), withCond(['poisoned']), sword, withCond(['restrained'], { ac: 5 }));
    expect(e.mode).toBe('normal');
    expect(e.attackRoll.roll.rolls).toHaveLength(1);
  });

  it('a melee hit on a Paralyzed target is a critical hit even without a natural 20', () => {
    const target = withCond(['paralyzed'], { hp: 100, maxHp: 100, ac: 5 });
    const e = performAttack(scriptedRng([10, 10, 4, 6]), makeCreature(), sword, target); // advantage: two d20, then 2 damage dice
    expect(e.attackRoll.roll.isNat20).toBe(false);
    expect(e.attackRoll.crit).toBe(true);
    expect(e.totalDamage).toBe(4 + 6 + 3);
  });

  it('a ranged hit on a Paralyzed target is not an automatic crit', () => {
    const target = withCond(['paralyzed'], { hp: 100, maxHp: 100, ac: 5 });
    const e = performAttack(scriptedRng([10, 10, 4]), makeCreature(), bow, target);
    expect(e.attackRoll.crit).toBe(false);
    expect(e.totalDamage).toBe(4 + 3);
  });

  it('a downed character counts as Unconscious: melee hits crit and add two death save failures', () => {
    const target = makeCreature({ hp: 0, status: 'down', maxHp: 40 });
    const e = performAttack(scriptedRng([10, 10, 2, 3]), makeCreature(), sword, target);
    expect(e.attackRoll.crit).toBe(true);
    expect(e.outcome?.failuresAdded).toBe(2);
  });

  it('Exhaustion subtracts 2 per level from the attack roll', () => {
    const tired = makeCreature({ exhaustion: 2 });
    const e = performAttack(scriptedRng([10]), tired, sword, makeCreature({ ac: 15 })); // 10 + 5 - 4 = 11
    expect(e.attackRoll.roll.total).toBe(11);
    expect(e.attackRoll.hit).toBe(false);
  });

  it('Petrified targets resist all damage', () => {
    const target = withCond(['petrified'], { hp: 100, maxHp: 100, ac: 1 });
    const e = performAttack(scriptedRng([15, 15, 8]), makeCreature(), sword, target); // advantage; 8 + 3 = 11 -> 5
    expect(e.totalDamage).toBe(5);
    expect(e.damage[0]!.effect).toBe('resisted');
  });
});

describe('saves and conditions', () => {
  it('Paralyzed, Stunned and Unconscious targets fail Dex saves without rolling', () => {
    for (const n of ['paralyzed', 'stunned', 'unconscious'] as const) {
      const target = withCond([n], { hp: 200, maxHp: 200 });
      const e = performSave(scriptedRng([6, 6, 6, 6, 6, 6, 6, 6]), makeCreature(), fireball, target); // only damage dice available
      expect(e.autoFail, n).toBe(true);
      expect(e.saveRoll.success).toBe(false);
      expect(e.totalDamage).toBe(48);
    }
  });

  it('auto-fail does not apply to Con saves', () => {
    const con: SaveOption = { ...fireball, ability: 'con' };
    const e = performSave(scriptedRng([15, 1, 1, 1, 1, 1, 1, 1, 1]), makeCreature(), con, withCond(['paralyzed'], { hp: 200, maxHp: 200 }));
    expect(e.autoFail).toBe(false);
    expect(e.saveRoll.success).toBe(true);
  });

  it('a Restrained creature has disadvantage on Dex saves', () => {
    const e = performSave(scriptedRng([18, 4, 1, 1, 1, 1, 1, 1, 1, 1]), makeCreature(), fireball, withCond(['restrained'], { hp: 200, maxHp: 200 }));
    expect(e.mode).toBe('disadvantage');
    expect(e.saveRoll.roll.natural).toBe(4);
    expect(e.saveRoll.success).toBe(false);
  });

  it('Exhaustion subtracts 2 per level from saves', () => {
    const e = performSave(scriptedRng([15, 1, 1, 1, 1, 1, 1, 1, 1]), makeCreature(), fireball, makeCreature({ exhaustion: 1, hp: 200, maxHp: 200 })); // 15 - 2 = 13 < 14
    expect(e.saveRoll.success).toBe(false);
  });
});

describe('inflicting conditions', () => {
  const knockdown: AttackOption = {
    name: 'Slam',
    toHit: 5,
    damage: [{ dice: '1d4', type: 'bludgeoning' }],
    effects: [{ condition: 'prone', duration: { kind: 'indefinite' }, maxSize: 'large' }],
  };

  it('a hit applies its conditions, and a miss does not', () => {
    const target = makeCreature({ ac: 10, hp: 100, maxHp: 100 });
    const hit = performAttack(scriptedRng([15, 2]), makeCreature({ id: 'bear' }), knockdown, target);
    expect(hit.applied).toEqual([{ target: 'Test', condition: 'prone' }]);
    expect(target.conditions).toMatchObject([{ name: 'prone', sourceId: 'bear' }]);

    const clean = makeCreature({ ac: 30, hp: 100, maxHp: 100 });
    const miss = performAttack(scriptedRng([5]), makeCreature(), knockdown, clean);
    expect(miss.applied).toEqual([]);
    expect(clean.conditions).toBeUndefined();
  });

  it('respects the size limit', () => {
    const giant = makeCreature({ ac: 10, size: 'huge', hp: 100, maxHp: 100 });
    expect(performAttack(scriptedRng([15, 2]), makeCreature(), knockdown, giant).applied).toEqual([]);
  });

  it('a save-to-avoid rider can be resisted', () => {
    const venom: AttackOption = {
      name: 'Bite',
      toHit: 5,
      damage: [{ dice: '1', type: 'piercing' }],
      effects: [{ condition: 'poisoned', duration: { kind: 'endOfTargetNextTurn' }, avoidSave: { ability: 'con', dc: 12 } }],
    };
    const resisted = makeCreature({ ac: 10, hp: 100, maxHp: 100 });
    expect(performAttack(scriptedRng([15, 15]), makeCreature(), venom, resisted).applied).toEqual([]); // save 15 >= 12
    const failed = makeCreature({ ac: 10, hp: 100, maxHp: 100 });
    expect(performAttack(scriptedRng([15, 5]), makeCreature(), venom, failed).applied).toHaveLength(1);
  });

  it('a failed save applies the conditions of a save effect, a success does not', () => {
    const scare: SaveOption = {
      name: 'Moan',
      ability: 'wis',
      dc: 13,
      halfOnSave: false,
      damage: [],
      effects: [{ condition: 'frightened', duration: { kind: 'startOfSourceNextTurn' } }],
    };
    const failed = makeCreature();
    const e = performSave(scriptedRng([5]), makeCreature({ id: 'cloaker' }), scare, failed);
    expect(e.applied).toEqual([{ target: 'Test', condition: 'frightened' }]);
    expect(failed.conditions).toMatchObject([{ name: 'frightened', sourceId: 'cloaker', expires: { id: 'cloaker', at: 'start' } }]);
    const saved = makeCreature();
    expect(performSave(scriptedRng([18]), makeCreature(), scare, saved).applied).toEqual([]);
  });

  it('respects condition immunities and does not condition the dead', () => {
    const immune = makeCreature({ ac: 10, hp: 100, maxHp: 100, conditionImmunities: ['prone'] });
    expect(performAttack(scriptedRng([15, 2]), makeCreature(), knockdown, immune).applied).toEqual([]);
    const weak = makeCreature({ ac: 10, hp: 1, maxHp: 1, kind: 'monster' });
    const e = performAttack(scriptedRng([15, 4]), makeCreature(), knockdown, weak);
    expect(weak.status).toBe('dead');
    expect(e.applied).toEqual([]);
  });
});
