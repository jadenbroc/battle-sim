import { rollD20, resolveMode, type D20Result, type RollMode } from './dice';
import { adjustAll, rollDamage, type AdjustedDamage } from './damage';
import { applyDamage, type DamageOutcome } from './hp';
import type { Rng } from './rng';
import { saveModifier, type AttackOption, type Creature, type SaveOption } from './types';

export interface AttackRollResult {
  roll: D20Result;
  hit: boolean;
  crit: boolean;
}

/** d20 + bonus vs AC. Natural 20 always hits and crits; natural 1 always misses. */
export function rollAttack(rng: Rng, toHit: number, ac: number, mode: RollMode = 'normal'): AttackRollResult {
  const roll = rollD20(rng, toHit, mode);
  const hit = roll.isNat20 || (!roll.isNat1 && roll.total >= ac);
  return { roll, hit, crit: roll.isNat20 };
}

export interface SaveRollResult {
  roll: D20Result;
  success: boolean;
}

/** d20 + modifier vs DC. No special effect on a natural 20 or 1. */
export function rollSave(rng: Rng, modifier: number, dc: number, mode: RollMode = 'normal'): SaveRollResult {
  const roll = rollD20(rng, modifier, mode);
  return { roll, success: roll.total >= dc };
}

export interface AttackEvent {
  kind: 'attack';
  attacker: string;
  target: string;
  option: string;
  attackRoll: AttackRollResult;
  damage: AdjustedDamage[];
  totalDamage: number;
  outcome: DamageOutcome | null;
}

export interface SaveEvent {
  kind: 'save';
  caster: string;
  target: string;
  option: string;
  saveRoll: SaveRollResult;
  damage: AdjustedDamage[];
  totalDamage: number;
  outcome: DamageOutcome | null;
}

export interface AdvantageFlags {
  advantage?: boolean;
  disadvantage?: boolean;
}

/** Resolve one attack roll against a target and apply any damage to it. Mutates `target`. */
export function performAttack(
  rng: Rng,
  attacker: Creature,
  option: AttackOption,
  target: Creature,
  flags: AdvantageFlags = {},
): AttackEvent {
  const mode = resolveMode(!!flags.advantage, !!flags.disadvantage);
  const attackRoll = rollAttack(rng, option.toHit, target.ac, mode);
  const base = { kind: 'attack' as const, attacker: attacker.name, target: target.name, option: option.name, attackRoll };
  if (!attackRoll.hit) return { ...base, damage: [], totalDamage: 0, outcome: null };

  const { parts, total } = adjustAll(rollDamage(rng, option.damage, { crit: attackRoll.crit }), target);
  const outcome = applyDamage(target, total, { crit: attackRoll.crit });
  return { ...base, damage: parts, totalDamage: total, outcome };
}

/** Force a saving throw and apply damage (full, halved, or none). Mutates `target`. */
export function performSave(
  rng: Rng,
  caster: Creature,
  option: SaveOption,
  target: Creature,
  flags: AdvantageFlags = {},
): SaveEvent {
  const mode = resolveMode(!!flags.advantage, !!flags.disadvantage);
  const saveRoll = rollSave(rng, saveModifier(target, option.ability), option.dc, mode);
  const base = { kind: 'save' as const, caster: caster.name, target: target.name, option: option.name, saveRoll };

  if (saveRoll.success && !option.halfOnSave) return { ...base, damage: [], totalDamage: 0, outcome: null };

  const { parts, total } = adjustAll(rollDamage(rng, option.damage), target, { halve: saveRoll.success });
  const outcome = applyDamage(target, total);
  return { ...base, damage: parts, totalDamage: total, outcome };
}
