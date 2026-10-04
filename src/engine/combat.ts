import { applyCondition, attackFlags, d20Penalty, defensesOf, isAutoCrit, saveFlags } from './conditions';
import { rollD20, resolveMode, type D20Result, type RollMode } from './dice';
import { adjustAll, rollDamage, withChosenType, type AdjustedDamage } from './damage';
import { applyDamage, type DamageOutcome } from './hp';
import type { Rng } from './rng';
import {
  saveModifier,
  type AttackOption,
  type ConditionEffect,
  type ConditionName,
  type Creature,
  type SaveOption,
} from './types';

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

export interface AppliedCondition {
  target: string;
  condition: ConditionName;
}

export interface AttackEvent {
  kind: 'attack';
  attacker: string;
  target: string;
  option: string;
  attackRoll: AttackRollResult;
  /** Advantage or disadvantage in effect (from the caller and from conditions). */
  mode: RollMode;
  /** The attack never misses and made no roll. */
  autoHit: boolean;
  damage: AdjustedDamage[];
  totalDamage: number;
  outcome: DamageOutcome | null;
  applied: AppliedCondition[];
}

export interface SaveEvent {
  kind: 'save';
  caster: string;
  target: string;
  option: string;
  saveRoll: SaveRollResult;
  /** The target failed automatically (Paralyzed, Stunned, ... on a Str or Dex save): no roll was made. */
  autoFail: boolean;
  mode: RollMode;
  damage: AdjustedDamage[];
  totalDamage: number;
  outcome: DamageOutcome | null;
  applied: AppliedCondition[];
}

export interface AdvantageFlags {
  advantage?: boolean;
  disadvantage?: boolean;
}

/**
 * A creature's saving throw, including conditions: automatic failure for Paralyzed / Petrified /
 * Stunned / Unconscious on Str and Dex, disadvantage on Dex while Restrained, and Exhaustion.
 */
export function creatureSave(
  rng: Rng,
  target: Creature,
  ability: SaveOption['ability'],
  dc: number,
  extra: AdvantageFlags = {},
): SaveRollResult & { autoFail: boolean; mode: RollMode } {
  const sf = saveFlags(target, ability);
  const mode = resolveMode(!!extra.advantage || sf.advantage, !!extra.disadvantage || sf.disadvantage);
  const modifier = saveModifier(target, ability) - d20Penalty(target);
  if (sf.autoFail) {
    const roll: D20Result = { natural: 0, rolls: [], modifier, total: 0, isNat20: false, isNat1: false };
    return { roll, success: false, autoFail: true, mode };
  }
  return { ...rollSave(rng, modifier, dc, mode), autoFail: false, mode };
}

/** Inflict an attack's or save's conditions on a target (honouring any save to avoid them). */
function inflict(rng: Rng, source: Creature, target: Creature, effects: readonly ConditionEffect[] | undefined): AppliedCondition[] {
  const applied: AppliedCondition[] = [];
  for (const effect of effects ?? []) {
    if (target.status === 'dead') break;
    if (effect.avoidSave && creatureSave(rng, target, effect.avoidSave.ability, effect.avoidSave.dc).success) continue;
    if (applyCondition(target, effect, { sourceId: source.id, actorId: source.id })) {
      applied.push({ target: target.name, condition: effect.condition });
    }
  }
  return applied;
}

/** Resolve one attack roll against a target and apply any damage and conditions. Mutates `target`. */
export function performAttack(
  rng: Rng,
  attacker: Creature,
  chosen: AttackOption,
  target: Creature,
  flags: AdvantageFlags = {},
): AttackEvent {
  const option = withChosenType(chosen, defensesOf(target));
  const melee = (option.range ?? 'melee') === 'melee';
  const cf = attackFlags(attacker, target, melee);
  const mode = option.autoHit ? 'normal' : resolveMode(!!flags.advantage || cf.advantage, !!flags.disadvantage || cf.disadvantage);

  // An auto-hit attack makes no roll: it hits, and with no attack roll it cannot crit.
  const rolled: AttackRollResult = option.autoHit
    ? { roll: { natural: 0, rolls: [], modifier: 0, total: 0, isNat20: false, isNat1: false }, hit: true, crit: false }
    : rollAttack(rng, option.toHit - d20Penalty(attacker), target.ac, mode);
  const crit = rolled.crit || (!option.autoHit && rolled.hit && isAutoCrit(target, melee));
  const attackRoll = { ...rolled, crit };
  const base = {
    kind: 'attack' as const,
    attacker: attacker.name,
    target: target.name,
    option: option.name,
    attackRoll,
    mode,
    autoHit: !!option.autoHit,
  };
  if (!attackRoll.hit) return { ...base, damage: [], totalDamage: 0, outcome: null, applied: [] };

  const { parts, total } = adjustAll(rollDamage(rng, option.damage, { crit }), defensesOf(target));
  const outcome = applyDamage(target, total, { crit });
  const applied = inflict(rng, attacker, target, option.effects);
  return { ...base, damage: parts, totalDamage: total, outcome, applied };
}

/** Force a saving throw and apply damage (full, halved, or none) and conditions. Mutates `target`. */
export function performSave(
  rng: Rng,
  caster: Creature,
  option: SaveOption,
  target: Creature,
  flags: AdvantageFlags = {},
): SaveEvent {
  const { autoFail, mode, ...saveRoll } = creatureSave(rng, target, option.ability, option.dc, flags);
  const base = { kind: 'save' as const, caster: caster.name, target: target.name, option: option.name, saveRoll, autoFail, mode };

  if (saveRoll.success && !option.halfOnSave) return { ...base, damage: [], totalDamage: 0, outcome: null, applied: [] };

  const { parts, total } = adjustAll(rollDamage(rng, option.damage), defensesOf(target), { halve: saveRoll.success });
  const outcome = applyDamage(target, total);
  const applied = saveRoll.success ? [] : inflict(rng, caster, target, option.effects);
  return { ...base, damage: parts, totalDamage: total, outcome, applied };
}
