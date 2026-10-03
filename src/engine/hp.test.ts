import { describe, expect, it } from 'vitest';
import { applyDamage, heal, rollDeathSave } from './hp';
import { makeCreature, scriptedRng } from './testUtil';

describe('applyDamage', () => {
  it('reduces HP', () => {
    const c = makeCreature();
    const o = applyDamage(c, 7);
    expect(c.hp).toBe(13);
    expect(o).toMatchObject({ hpBefore: 20, hpAfter: 13, statusAfter: 'alive' });
  });

  it('ignores zero damage and damage to the dead', () => {
    const c = makeCreature();
    applyDamage(c, 0);
    expect(c.hp).toBe(20);
    const dead = makeCreature({ hp: 0, status: 'dead' });
    expect(applyDamage(dead, 5).amount).toBe(0);
    expect(dead.status).toBe('dead');
  });

  it('kills a monster at 0 HP', () => {
    const m = makeCreature({ kind: 'monster', hp: 5 });
    const o = applyDamage(m, 5);
    expect(m.status).toBe('dead');
    expect(o.instantDeath).toBe(true);
  });

  it('knocks a character down at 0 HP with fresh death saves', () => {
    const c = makeCreature({ hp: 5, deathSaves: { successes: 2, failures: 2 } });
    applyDamage(c, 8);
    expect(c).toMatchObject({ hp: 0, status: 'down', deathSaves: { successes: 0, failures: 0 } });
  });

  it('kills a character outright when leftover damage >= max HP', () => {
    const c = makeCreature({ hp: 5, maxHp: 20 });
    expect(applyDamage(c, 25).instantDeath).toBe(true); // leftover 20
    expect(c.status).toBe('dead');
  });

  it('does not kill outright when leftover is just under max HP', () => {
    const c = makeCreature({ hp: 5, maxHp: 20 });
    applyDamage(c, 24); // leftover 19
    expect(c.status).toBe('down');
  });

  it('adds a death-save failure for damage while down, two on a crit', () => {
    const c = makeCreature({ hp: 0, status: 'down' });
    expect(applyDamage(c, 3).failuresAdded).toBe(1);
    expect(applyDamage(c, 3, { crit: true }).failuresAdded).toBe(2);
    expect(c.status).toBe('dead'); // 3 failures
  });

  it('kills a downed character hit for >= max HP', () => {
    const c = makeCreature({ hp: 0, status: 'down', maxHp: 20 });
    applyDamage(c, 20);
    expect(c.status).toBe('dead');
  });

  it('puts a stable character back to down with a failure', () => {
    const c = makeCreature({ hp: 0, status: 'stable' });
    applyDamage(c, 2);
    expect(c).toMatchObject({ status: 'down', deathSaves: { successes: 0, failures: 1 } });
  });
});

describe('heal', () => {
  it('restores HP up to max', () => {
    const c = makeCreature({ hp: 10 });
    expect(heal(c, 50)).toBe(10);
    expect(c.hp).toBe(20);
  });

  it('brings a downed character back up and clears death saves', () => {
    const c = makeCreature({ hp: 0, status: 'down', deathSaves: { successes: 1, failures: 2 } });
    heal(c, 4);
    expect(c).toMatchObject({ hp: 4, status: 'alive', deathSaves: { successes: 0, failures: 0 } });
  });

  it('does not revive the dead', () => {
    const c = makeCreature({ hp: 0, status: 'dead' });
    expect(heal(c, 10)).toBe(0);
    expect(c.status).toBe('dead');
  });
});

describe('rollDeathSave', () => {
  const down = () => makeCreature({ hp: 0, status: 'down' });

  it('counts 10+ as a success and 9 or less as a failure', () => {
    const c = down();
    expect(rollDeathSave(scriptedRng([10]), c).outcome).toBe('success');
    expect(rollDeathSave(scriptedRng([9]), c).outcome).toBe('failure');
    expect(c.deathSaves).toEqual({ successes: 1, failures: 1 });
  });

  it('a natural 1 counts as two failures', () => {
    const c = down();
    rollDeathSave(scriptedRng([1]), c);
    expect(c.deathSaves.failures).toBe(2);
  });

  it('a natural 20 regains 1 HP', () => {
    const c = down();
    expect(rollDeathSave(scriptedRng([20]), c).outcome).toBe('revived');
    expect(c).toMatchObject({ hp: 1, status: 'alive' });
  });

  it('three successes stabilize', () => {
    const c = down();
    rollDeathSave(scriptedRng([12]), c);
    rollDeathSave(scriptedRng([12]), c);
    expect(rollDeathSave(scriptedRng([12]), c).outcome).toBe('stabilized');
    expect(c.status).toBe('stable');
  });

  it('three failures kill', () => {
    const c = down();
    rollDeathSave(scriptedRng([5]), c);
    expect(rollDeathSave(scriptedRng([1]), c).outcome).toBe('died');
    expect(c.status).toBe('dead');
  });

  it('refuses to roll for a creature that is not down', () => {
    expect(() => rollDeathSave(scriptedRng([10]), makeCreature())).toThrow();
  });
});
