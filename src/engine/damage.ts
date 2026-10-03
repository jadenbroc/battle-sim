import { rollDice } from './dice';
import type { Rng } from './rng';
import type { DamageComponent, DamageType, Defenses } from './types';

export interface RolledDamage {
  type: DamageType;
  amount: number;
}

export type DamageEffect = 'normal' | 'resisted' | 'vulnerable' | 'immune';

export interface AdjustedDamage {
  type: DamageType;
  /** Damage rolled before any adjustment. */
  raw: number;
  /** Damage that actually lands. */
  final: number;
  effect: DamageEffect;
}

/** Roll each damage component. Crits double the dice, not the modifier. Never below 0. */
export function rollDamage(rng: Rng, components: readonly DamageComponent[], opts: { crit?: boolean } = {}): RolledDamage[] {
  return components.map((c) => ({
    type: c.type,
    amount: Math.max(0, rollDice(rng, c.dice, opts).total),
  }));
}

/**
 * Apply defenses to one typed chunk of damage, in the 2024 order:
 * 1. Immunity zeroes it.
 * 2. A successful save's halving (when `halve` is set), rounded down.
 * 3. Resistance halves it, rounded down.
 * 4. Vulnerability doubles it.
 * Resistance and vulnerability each apply at most once, resistance first.
 */
export function adjustDamage(raw: RolledDamage, defenses: Defenses, opts: { halve?: boolean } = {}): AdjustedDamage {
  const { type } = raw;
  if (defenses.immunities.includes(type)) return { type, raw: raw.amount, final: 0, effect: 'immune' };

  let amount = raw.amount;
  if (opts.halve) amount = Math.floor(amount / 2);

  const resisted = defenses.resistances.includes(type);
  const vulnerable = defenses.vulnerabilities.includes(type);
  if (resisted) amount = Math.floor(amount / 2);
  if (vulnerable) amount *= 2;

  const effect: DamageEffect = resisted && !vulnerable ? 'resisted' : vulnerable && !resisted ? 'vulnerable' : 'normal';
  return { type, raw: raw.amount, final: amount, effect };
}

/** Adjust every component and return the breakdown plus the total that lands. */
export function adjustAll(
  parts: readonly RolledDamage[],
  defenses: Defenses,
  opts: { halve?: boolean } = {},
): { parts: AdjustedDamage[]; total: number } {
  const adjusted = parts.map((p) => adjustDamage(p, defenses, opts));
  return { parts: adjusted, total: adjusted.reduce((sum, p) => sum + p.final, 0) };
}
