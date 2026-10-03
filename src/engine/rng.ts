/** Seeded RNG (mulberry32) so any fight can be replayed exactly. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Roll one die with the given number of sides: 1..sides. */
  die(sides: number): number;
  /** Fair coin flip. */
  coin(): boolean;
  /** Current internal state; pass to createRng to resume from this point. */
  state(): number;
}

/** Turn any string or number into a 32-bit seed. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let s = hashSeed(seed);

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    die: (sides) => {
      if (!Number.isInteger(sides) || sides < 1) throw new RangeError(`Invalid die: d${sides}`);
      return int(1, sides);
    },
    coin: () => next() < 0.5,
    state: () => s,
  };
}
