import { describe, expect, it } from 'vitest';
import { runFight } from '../engine/fight';
import { createRng } from '../engine/rng';
import { sampleFight } from '../sample';
import { formatEvent, viewAt } from './replay';

describe('replay', () => {
  const config = sampleFight();
  const result = runFight(config, createRng('replay-test'), { log: true });

  it('starts every fighter at full HP', () => {
    const start = viewAt(config, result.log, 0);
    expect(start).toHaveLength(7);
    expect(start.every((v) => v.hp === v.maxHp && v.status === 'alive')).toBe(true);
  });

  it('ends consistent with the fight result', () => {
    const end = viewAt(config, result.log, result.log.length);
    for (const s of result.stats) {
      const v = end.find((f) => f.name === s.name)!;
      expect(v.status !== 'dead').toBe(s.survived);
    }
    if (result.outcome === 'won-clean' || result.outcome === 'won-deaths') {
      expect(end.filter((v) => v.team === 'enemies').every((v) => v.status !== 'alive')).toBe(true);
    }
  });

  it('formats every event into readable text', () => {
    for (const { event } of result.log) {
      const f = formatEvent(event);
      expect(f.text.length).toBeGreaterThan(0);
      expect(f.text).not.toContain('undefined');
      expect(f.text).not.toContain('NaN');
    }
  });

  it('formats an automatic hit', () => {
    const e = { kind: 'attack', attacker: 'Wizard', target: 'Goblin 1', option: 'Magic Missile', attackRoll: { roll: { natural: 0, rolls: [], modifier: 0, total: 0, isNat20: false, isNat1: false }, hit: true, crit: false }, mode: 'normal', autoHit: true, damage: [{ type: 'force', raw: 4, final: 4, effect: 'normal' }], totalDamage: 4, outcome: null, applied: [] } as const;
    expect(formatEvent(e as never).text).toBe("Wizard's Magic Missile strikes Goblin 1 automatically for 4 force.");
  });

  it('formats recharge rolls', () => {
    expect(formatEvent({ kind: 'recharge', actor: 'Dragon', option: 'Fire Breath', roll: 5, success: true }).text).toBe(
      'Dragon rolls to recharge Fire Breath: 5, recharged!',
    );
    expect(formatEvent({ kind: 'recharge', actor: 'Dragon', option: 'Fire Breath', roll: 2, success: false }).text).toContain('still recharging');
  });

  it('formats a representative attack', () => {
    const attack = result.log.find((l) => l.event.kind === 'attack')!;
    expect(formatEvent(attack.event).text).toMatch(/attacks .* with .*: \d+, (miss|hit|CRITICAL HIT)/);
  });
});
