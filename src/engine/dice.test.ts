import { describe, expect, it } from 'vitest';
import { averageDice, parseDice, resolveMode, rollD20, rollDice } from './dice';
import { createRng } from './rng';

describe('parseDice', () => {
  it('parses common notation', () => {
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
    expect(parseDice('8d6 - 1')).toEqual({ count: 8, sides: 6, modifier: -1 });
    expect(parseDice('1D4')).toEqual({ count: 1, sides: 4, modifier: 0 });
  });

  it('parses flat numbers', () => {
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, modifier: 5 });
    expect(parseDice('-2')).toEqual({ count: 0, sides: 0, modifier: -2 });
  });

  it('rejects garbage', () => {
    expect(() => parseDice('banana')).toThrow();
    expect(() => parseDice('2d')).toThrow();
    expect(() => parseDice('2d0')).toThrow();
  });
});

describe('rollDice', () => {
  it('keeps totals within bounds', () => {
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const { total, rolls } = rollDice(r, '3d6+2');
      expect(rolls).toHaveLength(3);
      expect(total).toBeGreaterThanOrEqual(5);
      expect(total).toBeLessThanOrEqual(20);
    }
  });

  it('doubles dice but not the modifier on a crit', () => {
    const r = createRng(2);
    for (let i = 0; i < 500; i++) {
      const { total, rolls } = rollDice(r, '1d8+4', { crit: true });
      expect(rolls).toHaveLength(2);
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(20);
    }
  });

  it('averages near the expected value', () => {
    const r = createRng(3);
    let sum = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) sum += rollDice(r, '2d6+3').total;
    expect(sum / n).toBeCloseTo(averageDice('2d6+3'), 1);
  });

  it('is replayable from a seed', () => {
    expect(rollDice(createRng('x'), '4d8')).toEqual(rollDice(createRng('x'), '4d8'));
  });
});

describe('rollD20', () => {
  it('adds the modifier and flags naturals', () => {
    const r = createRng(11);
    let saw20 = false;
    let saw1 = false;
    for (let i = 0; i < 2000; i++) {
      const res = rollD20(r, 5);
      expect(res.total).toBe(res.natural + 5);
      expect(res.rolls).toHaveLength(1);
      if (res.isNat20) saw20 = true;
      if (res.isNat1) saw1 = true;
    }
    expect(saw20 && saw1).toBe(true);
  });

  it('advantage takes the higher and disadvantage the lower of two dice', () => {
    const r = createRng(12);
    for (let i = 0; i < 500; i++) {
      const adv = rollD20(r, 0, 'advantage');
      expect(adv.rolls).toHaveLength(2);
      expect(adv.natural).toBe(Math.max(...adv.rolls));
      const dis = rollD20(r, 0, 'disadvantage');
      expect(dis.natural).toBe(Math.min(...dis.rolls));
    }
  });

  it('advantage and disadvantage shift the mean as expected', () => {
    const r = createRng(13);
    const n = 50000;
    let adv = 0;
    let dis = 0;
    for (let i = 0; i < n; i++) {
      adv += rollD20(r, 0, 'advantage').natural;
      dis += rollD20(r, 0, 'disadvantage').natural;
    }
    expect(adv / n).toBeCloseTo(13.825, 1);
    expect(dis / n).toBeCloseTo(7.175, 1);
  });
});

describe('resolveMode', () => {
  it('cancels when both or neither apply', () => {
    expect(resolveMode(false, false)).toBe('normal');
    expect(resolveMode(true, true)).toBe('normal');
    expect(resolveMode(true, false)).toBe('advantage');
    expect(resolveMode(false, true)).toBe('disadvantage');
  });
});

describe('averageDice', () => {
  it('computes averages', () => {
    expect(averageDice('1d6')).toBe(3.5);
    expect(averageDice('2d8+4')).toBe(13);
    expect(averageDice('7')).toBe(7);
  });
});
