import type { Rng } from './rng';

export interface DiceExpr {
  count: number;
  sides: number;
  modifier: number;
}

export interface DiceRoll {
  rolls: number[];
  modifier: number;
  total: number;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface D20Result {
  /** The die that counts (after advantage/disadvantage). */
  natural: number;
  /** Every die rolled (two for advantage/disadvantage). */
  rolls: number[];
  modifier: number;
  total: number;
  isNat20: boolean;
  isNat1: boolean;
}

const DICE_RE = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i;

/** Parse notation like "d20", "2d6+3", "8d6 - 1", or a flat "5". */
export function parseDice(notation: string): DiceExpr {
  const text = notation.trim();
  if (/^[+-]?\d+$/.test(text)) return { count: 0, sides: 0, modifier: parseInt(text, 10) };
  const m = DICE_RE.exec(text);
  if (!m) throw new Error(`Invalid dice notation: "${notation}"`);
  const count = m[1] === '' ? 1 : parseInt(m[1]!, 10);
  const sides = parseInt(m[2]!, 10);
  if (sides < 1) throw new Error(`Invalid dice notation: "${notation}"`);
  const modifier = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4]!, 10) : 0;
  return { count, sides, modifier };
}

function toExpr(expr: string | DiceExpr): DiceExpr {
  return typeof expr === 'string' ? parseDice(expr) : expr;
}

/**
 * Roll dice. On a critical hit the dice are doubled; the flat modifier is not.
 * Totals are not floored here (callers apply the minimum-0 damage rule).
 */
export function rollDice(rng: Rng, expr: string | DiceExpr, opts: { crit?: boolean } = {}): DiceRoll {
  const { count, sides, modifier } = toExpr(expr);
  const n = opts.crit ? count * 2 : count;
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(rng.die(sides));
  return { rolls, modifier, total: rolls.reduce((a, b) => a + b, 0) + modifier };
}

/** Roll a d20 test with optional advantage/disadvantage. */
export function rollD20(rng: Rng, modifier = 0, mode: RollMode = 'normal'): D20Result {
  const rolls = [rng.die(20)];
  if (mode !== 'normal') rolls.push(rng.die(20));
  const natural = mode === 'advantage' ? Math.max(...rolls) : mode === 'disadvantage' ? Math.min(...rolls) : rolls[0]!;
  return { natural, rolls, modifier, total: natural + modifier, isNat20: natural === 20, isNat1: natural === 1 };
}

/** Combine sources of advantage and disadvantage: any of both cancel out entirely. */
export function resolveMode(hasAdvantage: boolean, hasDisadvantage: boolean): RollMode {
  if (hasAdvantage === hasDisadvantage) return 'normal';
  return hasAdvantage ? 'advantage' : 'disadvantage';
}

/** Average result of a dice expression (used for expected-damage decisions). */
export function averageDice(expr: string | DiceExpr): number {
  const { count, sides, modifier } = toExpr(expr);
  return (count * (sides + 1)) / 2 + modifier;
}
