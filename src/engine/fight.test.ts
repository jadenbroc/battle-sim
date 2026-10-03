import { describe, expect, it } from 'vitest';
import { runBulk } from './bulk';
import { runFight, rollInitiative, type FightConfig } from './fight';
import { createRng } from './rng';
import { makeCombatant, scriptedRng } from './testUtil';

describe('rollInitiative', () => {
  it('orders by d20 + Dex modifier', () => {
    const a = makeCombatant('a', 'party');
    const b = makeCombatant('b', 'party');
    const order = rollInitiative(scriptedRng([5, 15]), [a, b], false);
    expect(order.map((o) => o.fighter.creature.id)).toEqual(['b', 'a']);
    expect(order.map((o) => o.total)).toEqual([15, 5]);
  });

  it('breaks ties by higher Dex score', () => {
    const a = makeCombatant('a', 'party', { dex: 10 }); // roll 12 + 0
    const b = makeCombatant('b', 'party', { dex: 14 }); // roll 10 + 2
    const order = rollInitiative(scriptedRng([12, 10]), [a, b], false);
    expect(order.map((o) => o.fighter.creature.id)).toEqual(['b', 'a']);
  });

  it('includes the initiative bonus', () => {
    const a = makeCombatant('a', 'party', { initiativeBonus: 5 });
    const b = makeCombatant('b', 'party');
    const order = rollInitiative(scriptedRng([10, 12]), [a, b], false);
    expect(order[0]!.fighter.creature.id).toBe('a');
  });

  it('rolls individually by default and once per group when grouping', () => {
    const g1 = makeCombatant('g1', 'enemies', { groupKey: 'goblin' });
    const g2 = makeCombatant('g2', 'enemies', { groupKey: 'goblin' });
    const hero = makeCombatant('hero', 'party');

    const solo = rollInitiative(scriptedRng([3, 17, 10]), [g1, g2, hero], false);
    expect(solo.find((o) => o.fighter === g1)!.total).toBe(3);
    expect(solo.find((o) => o.fighter === g2)!.total).toBe(17);

    const grouped = rollInitiative(scriptedRng([3, 10]), [g1, g2, hero], true);
    expect(grouped.find((o) => o.fighter === g1)!.total).toBe(3);
    expect(grouped.find((o) => o.fighter === g2)!.total).toBe(3);
    expect(grouped.find((o) => o.fighter === hero)!.total).toBe(10);
  });
});

const easyFight = (): FightConfig => ({
  combatants: [
    makeCombatant('hero', 'party', { toHit: 20, dmg: '100', hp: 50 }),
    makeCombatant('goblin', 'enemies', { toHit: -10, dmg: '1', hp: 7, ac: 10 }),
  ],
});

describe('runFight', () => {
  it('a mighty hero beats a goblin cleanly', () => {
    const r = runFight(easyFight(), createRng('easy'));
    expect(r.outcome).toBe('won-clean');
    expect(r.stats.find((s) => s.id === 'goblin')!.survived).toBe(false);
    expect(r.stats.find((s) => s.id === 'hero')!.damageDealt).toBeGreaterThan(0);
  });

  it('is exactly replayable from a seed', () => {
    const cfg: FightConfig = {
      combatants: [makeCombatant('a', 'party', { hp: 30 }), makeCombatant('b', 'enemies', { hp: 30 })],
    };
    const one = runFight(cfg, createRng('replay'), { log: true });
    const two = runFight(cfg, createRng('replay'), { log: true });
    expect(two).toEqual(one);
  });

  it('does not mutate the config it was given', () => {
    const cfg = easyFight();
    runFight(cfg, createRng(1));
    expect(cfg.combatants.every((c) => c.creature.hp === c.creature.maxHp && c.creature.status === 'alive')).toBe(true);
  });

  it('reports a TPK when the party falls', () => {
    const cfg: FightConfig = {
      combatants: [
        makeCombatant('hero', 'party', { toHit: -10, dmg: '1', hp: 5 }),
        makeCombatant('ogre', 'enemies', { toHit: 30, dmg: '100', hp: 500, ac: 30 }),
      ],
    };
    const r = runFight(cfg, createRng('tpk'));
    expect(r.outcome).toBe('tpk');
  });

  it('calls a fight with no damage dealt a stalemate at the round cap', () => {
    const cfg: FightConfig = {
      combatants: [makeCombatant('a', 'party', { dmg: '0' }), makeCombatant('b', 'enemies', { dmg: '0' })],
    };
    const r = runFight(cfg, createRng('stall'));
    expect(r.outcome).toBe('stalemate');
    expect(r.rounds).toBe(30);
  });

  it('honours a custom round cap', () => {
    const cfg: FightConfig = {
      combatants: [makeCombatant('a', 'party', { dmg: '0' }), makeCombatant('b', 'enemies', { dmg: '0' })],
      options: { roundCap: 5 },
    };
    expect(runFight(cfg, createRng('cap')).rounds).toBe(5);
  });

  it('separates wins with deaths from clean wins', () => {
    const cfg: FightConfig = {
      combatants: [
        makeCombatant('tank', 'party', { toHit: 30, dmg: '200', hp: 50, dex: 20 }),
        makeCombatant('squishy', 'party', { toHit: -10, dmg: '1', hp: 1, ac: 1 }),
        makeCombatant('boss', 'enemies', { toHit: 30, dmg: '1', hp: 100, ac: 1, groupKey: 'boss' }),
      ],
    };
    // Make the boss crush the squishy one (instant death needs leftover >= max HP).
    cfg.combatants[2]!.profile = 'weakest';
    cfg.combatants[2]!.actions = [
      { kind: 'attack', name: 'Smash', attack: { name: 'Smash', toHit: 30, damage: [{ dice: '5', type: 'bludgeoning' }] } },
    ];
    // Boss goes first (initiative bonus) and kills the 1-HP character outright.
    cfg.combatants[2]!.initiativeBonus = 100;
    const r = runFight(cfg, createRng('deaths'));
    expect(r.outcome).toBe('won-deaths');
    expect(r.stats.find((s) => s.id === 'squishy')!.survived).toBe(false);
  });

  it('logs initiative, rounds and the end when logging is on', () => {
    const r = runFight(easyFight(), createRng('log'), { log: true });
    const kinds = r.log.map((l) => l.event.kind);
    expect(kinds[0]).toBe('initiative');
    expect(kinds).toContain('round-start');
    expect(kinds).toContain('attack');
    expect(kinds.at(-1)).toBe('end');
    expect(runFight(easyFight(), createRng('log')).log).toEqual([]);
  });

  it('makes downed characters roll death saves on their turn', () => {
    const cfg: FightConfig = {
      combatants: [
        makeCombatant('hero', 'party', { toHit: -10, dmg: '1', hp: 10 }),
        makeCombatant('tank', 'party', { toHit: -10, dmg: '1', hp: 500 }), // keeps the fight going
        makeCombatant('ogre', 'enemies', { toHit: 30, dmg: '12', hp: 500, ac: 30 }),
      ],
    };
    cfg.combatants[2]!.initiativeBonus = 100;
    const r = runFight(cfg, createRng('death-saves'), { log: true });
    expect(r.log.some((l) => l.event.kind === 'death-save')).toBe(true);
  });

  it('refuses a fight with no enemies', () => {
    expect(() => runFight({ combatants: [makeCombatant('a', 'party')] }, createRng(1))).toThrow();
  });

  it('runs multiattack as several attacks per turn', () => {
    const hero = makeCombatant('hero', 'party', { toHit: 30, dmg: '1', hp: 50 });
    hero.actions = [
      { kind: 'attack', name: 'Extra Attack', count: 2, attack: { name: 'Sword', toHit: 30, damage: [{ dice: '1', type: 'slashing' }] } },
    ];
    hero.initiativeBonus = 100;
    const foe = makeCombatant('foe', 'enemies', { hp: 500, dmg: '0', ac: 1 });
    const r = runFight({ ...{ combatants: [hero, foe] }, options: { roundCap: 1 } }, createRng('multi'), { log: true });
    const heroAttacks = r.log.filter((l) => l.event.kind === 'attack' && l.event.attacker === 'hero');
    expect(heroAttacks).toHaveLength(2);
  });
});

describe('runBulk', () => {
  const cfg: FightConfig = {
    combatants: [
      makeCombatant('hero', 'party', { hp: 30 }),
      makeCombatant('goblin', 'enemies', { hp: 30 }),
    ],
  };

  it('is deterministic for a seed', () => {
    expect(runBulk(cfg, 200, 'bulk')).toEqual(runBulk(cfg, 200, 'bulk'));
  });

  it('buckets add up to the number of runs', () => {
    const r = runBulk(cfg, 500, 's');
    const sum = Object.values(r.buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(500);
    expect(r.winRate).toBeCloseTo((r.buckets['won-clean'] + r.buckets['won-deaths']) / 500, 10);
  });

  it('an even matchup lands near 50%', () => {
    const r = runBulk(cfg, 2000, 'even');
    expect(r.winRate).toBeGreaterThan(0.35);
    expect(r.winRate).toBeLessThan(0.65);
  });

  it('a mismatch is a near-certain win with high survival', () => {
    const r = runBulk(easyFight(), 300, 'mismatch');
    expect(r.winRate).toBeGreaterThan(0.99);
    expect(r.combatants.find((c) => c.id === 'hero')!.survivalRate).toBe(1);
    expect(r.combatants.find((c) => c.id === 'hero')!.avgDamagePerRound).toBeGreaterThan(0);
  });

  it('reports progress', () => {
    const calls: number[] = [];
    runBulk(cfg, 500, 'p', (done) => calls.push(done));
    expect(calls.at(-1)).toBe(500);
  });
});
