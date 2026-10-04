import { rollDice } from './dice';
import type { Rng } from './rng';
import type { AttackOption, DamageComponent, DamageType, Defenses } from './types';

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

/** Damage multiplier of a type against defenses: 0 immune, 0.5 resistant, 2 vulnerable. */
export function damageFactor(type: DamageType, d: Defenses): number {
  if (d.immunities.includes(type)) return 0;
  return (d.resistances.includes(type) ? 0.5 : 1) * (d.vulnerabilities.includes(type) ? 2 : 1);
}

/** The type that does the most against these defenses; the first listed wins a tie. */
export function pickDamageType(types: readonly DamageType[], d: Defenses): DamageType {
  return types.reduce((best, t) => (damageFactor(t, d) > damageFactor(best, d) ? t : best));
}

/** An attack whose type is chosen per cast, with the best type filled in for this target. */
export function withChosenType(option: AttackOption, d: Defenses): AttackOption {
  if (!option.damageTypes?.length || option.damage.length === 0) return option;
  const type = pickDamageType(option.damageTypes, d);
  return { ...option, damage: option.damage.map((c, i) => (i === 0 ? { ...c, type } : c)) };
}
