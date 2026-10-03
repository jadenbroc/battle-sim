import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('goblins');
    const b = createRng('goblins');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('next() stays in [0, 1)', () => {
    const r = createRng(42);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('die() covers every face and nothing else', () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.die(6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('d20 distribution is roughly uniform', () => {
    const r = createRng('uniform');
    const counts = new Array(21).fill(0);
    const n = 200000;
    for (let i = 0; i < n; i++) counts[r.die(20)]++;
    for (let f = 1; f <= 20; f++) expect(counts[f] / n).toBeCloseTo(0.05, 2);
  });

  it('resumes from saved state', () => {
    const r = createRng(99);
    r.next();
    r.next();
    const resumed = createRng(r.state());
    expect(resumed.next()).toBe(r.next());
  });

  it('coin() is roughly fair', () => {
    const r = createRng(5);
    let heads = 0;
    for (let i = 0; i < 20000; i++) if (r.coin()) heads++;
    expect(heads / 20000).toBeCloseTo(0.5, 1);
  });

  it('rejects invalid ranges', () => {
    const r = createRng(1);
    expect(() => r.int(5, 1)).toThrow(RangeError);
    expect(() => r.die(0)).toThrow(RangeError);
    expect(() => r.int(1.5, 3)).toThrow(RangeError);
  });
});
