import { describe, expect, it } from 'vitest';
import { performAttack, performSave, rollAttack, rollSave } from './combat';
import { makeCreature, scriptedRng } from './testUtil';
import type { AttackOption, SaveOption } from './types';

describe('rollAttack', () => {
  it('hits when total meets AC and misses below it', () => {
    expect(rollAttack(scriptedRng([10]), 5, 15).hit).toBe(true);
    expect(rollAttack(scriptedRng([9]), 5, 15).hit).toBe(false);
  });

  it('natural 20 always hits and crits', () => {
    const r = rollAttack(scriptedRng([20]), -10, 30);
    expect(r).toMatchObject({ hit: true, crit: true });
  });

  it('natural 1 always misses', () => {
    const r = rollAttack(scriptedRng([1]), 30, 5);
    expect(r).toMatchObject({ hit: false, crit: false });
  });

  it('uses advantage to take the better die', () => {
    expect(rollAttack(scriptedRng([2, 18]), 0, 15, 'advantage').hit).toBe(true);
    expect(rollAttack(scriptedRng([2, 18]), 0, 15, 'disadvantage').hit).toBe(false);
  });
});

describe('rollSave', () => {
  it('succeeds when total meets DC, with no special nat 20/1 effect', () => {
    expect(rollSave(scriptedRng([12]), 3, 15).success).toBe(true);
    expect(rollSave(scriptedRng([11]), 3, 15).success).toBe(false);
    expect(rollSave(scriptedRng([20]), -10, 15).success).toBe(false);
    expect(rollSave(scriptedRng([1]), 30, 15).success).toBe(true);
  });
});

const sword: AttackOption = { name: 'Longsword', toHit: 5, damage: [{ dice: '1d8+3', type: 'slashing' }] };
const fireball: SaveOption = {
  name: 'Fireball',
  ability: 'dex',
  dc: 14,
  halfOnSave: true,
  damage: [{ dice: '8d6', type: 'fire' }],
};

describe('performAttack', () => {
  it('rolls to hit then damage, and applies it', () => {
    const attacker = makeCreature({ name: 'Fighter' });
    const target = makeCreature({ name: 'Goblin', ac: 12, hp: 20 });
    const e = performAttack(scriptedRng([10, 4]), attacker, sword, target); // 10+5=15 hits, 4+3=7
    expect(e.attackRoll.hit).toBe(true);
    expect(e.totalDamage).toBe(7);
    expect(target.hp).toBe(13);
  });

  it('does nothing on a miss', () => {
    const target = makeCreature({ ac: 20 });
    const e = performAttack(scriptedRng([5]), makeCreature(), sword, target);
    expect(e).toMatchObject({ totalDamage: 0, outcome: null });
    expect(target.hp).toBe(20);
  });

  it('doubles dice on a crit', () => {
    const target = makeCreature({ hp: 50, maxHp: 50 });
    const e = performAttack(scriptedRng([20, 4, 6]), makeCreature(), sword, target);
    expect(e.attackRoll.crit).toBe(true);
    expect(e.totalDamage).toBe(4 + 6 + 3);
  });

  it('applies resistance to the damage type', () => {
    const target = makeCreature({ hp: 50, maxHp: 50, resistances: ['slashing'], ac: 5 });
    const e = performAttack(scriptedRng([15, 8]), makeCreature(), sword, target); // 11 -> 5
    expect(e.totalDamage).toBe(5);
    expect(e.damage[0]!.effect).toBe('resisted');
  });

  it('advantage and disadvantage cancel', () => {
    const target = makeCreature({ ac: 20 });
    // Normal single roll of 15 + 5 = 20 hits; a cancelled mode must not roll two dice.
    const e = performAttack(scriptedRng([15, 1]), makeCreature(), sword, target, { advantage: true, disadvantage: true });
    expect(e.attackRoll.roll.rolls).toHaveLength(1);
    expect(e.attackRoll.hit).toBe(true);
  });

  it('knocks a monster dead', () => {
    const target = makeCreature({ kind: 'monster', hp: 3, ac: 5 });
    performAttack(scriptedRng([15, 5]), makeCreature(), sword, target);
    expect(target.status).toBe('dead');
  });
});

describe('performSave', () => {
  const dice = (n: number) => new Array(8).fill(n);

  it('deals full damage on a failed save', () => {
    const target = makeCreature({ hp: 100, maxHp: 100 }); // dex mod 0
    const e = performSave(scriptedRng([5, ...dice(3)]), makeCreature(), fireball, target); // 5 < 14
    expect(e.saveRoll.success).toBe(false);
    expect(e.totalDamage).toBe(24);
    expect(target.hp).toBe(76);
  });

  it('halves damage (rounded down) on a successful save', () => {
    const target = makeCreature({ hp: 100, maxHp: 100 });
    const e = performSave(scriptedRng([15, ...dice(3), ]), makeCreature(), fireball, target);
    expect(e.saveRoll.success).toBe(true);
    expect(e.totalDamage).toBe(12);
  });

  it('negates damage on a save when the spell does not halve', () => {
    const target = makeCreature({ hp: 100, maxHp: 100 });
    const e = performSave(scriptedRng([15, ...dice(3)]), makeCreature(), { ...fireball, halfOnSave: false }, target);
    expect(e).toMatchObject({ totalDamage: 0, outcome: null });
    expect(target.hp).toBe(100);
  });

  it('uses the target save bonus', () => {
    const target = makeCreature({ hp: 100, maxHp: 100, saveBonuses: { dex: 6 } });
    const e = performSave(scriptedRng([8, ...dice(3)]), makeCreature(), fireball, target); // 8+6=14 meets DC
    expect(e.saveRoll.success).toBe(true);
  });

  it('applies halving before resistance', () => {
    const target = makeCreature({ hp: 100, maxHp: 100, resistances: ['fire'] });
    const e = performSave(scriptedRng([15, ...dice(3)]), makeCreature(), fireball, target); // 24 -> 12 -> 6
    expect(e.totalDamage).toBe(6);
  });
});
