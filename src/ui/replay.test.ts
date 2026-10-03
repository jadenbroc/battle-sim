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

  it('formats a representative attack', () => {
    const attack = result.log.find((l) => l.event.kind === 'attack')!;
    expect(formatEvent(attack.event).text).toMatch(/attacks .* with .*: \d+, (miss|hit|CRITICAL HIT)/);
  });
});
