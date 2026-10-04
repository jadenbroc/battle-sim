import { resolveMode, type RollMode } from './dice';
import {
  DAMAGE_TYPES,
  SIZES,
  type Ability,
  type ActiveCondition,
  type ConditionEffect,
  type ConditionName,
  type Creature,
  type Defenses,
  type Size,
} from './types';

// The 2024 condition rules, applied to a theater-of-the-mind fight (no grid):
// - "within 5 feet" is decided by the attack type: melee attacks are, ranged ones are not.
// - A frightened creature's source of fear is assumed to be in line of sight.
// - Movement effects (Speed 0, being dragged, standing up) have no effect, except that a prone
//   creature stands at the start of its turn when nothing pins it down.
// - A creature at 0 HP (down or stable) counts as Unconscious.

/** Every condition affecting the creature, including ones implied by others and by 0 HP. */
export function activeNames(c: Creature): Set<ConditionName> {
  const names = new Set<ConditionName>((c.conditions ?? []).map((x) => x.name));
  if (c.status === 'down' || c.status === 'stable') names.add('unconscious');
  if (names.has('unconscious')) {
    names.add('incapacitated');
    names.add('prone');
  }
  if (names.has('paralyzed') || names.has('petrified') || names.has('stunned')) names.add('incapacitated');
  return names;
}

export const hasCondition = (c: Creature, name: ConditionName): boolean => activeNames(c).has(name);

/** Can the creature take actions, bonus actions and reactions? */
export function canAct(c: Creature): boolean {
  return c.status === 'alive' && !hasCondition(c, 'incapacitated');
}

/** Armor Class including bonuses from spells (Shield of Faith, Haste). */
export function armorClass(c: Creature): number {
  return c.ac + (c.rollMods ?? []).reduce((sum, m) => sum + (m.acBonus ?? 0), 0);
}

/** Does a spell make this creature take no damage from Magic Missile (Shield)? */
export const blocksMagicMissile = (c: Creature): boolean => (c.rollMods ?? []).some((m) => m.blocksMagicMissile);

/** Does a spell give this creature advantage on Dexterity saving throws (Haste)? */
export const hasDexSaveAdvantage = (c: Creature): boolean => (c.rollMods ?? []).some((m) => m.dexSaveAdvantage);

/** Exhaustion: -2 on every D20 Test per level. */
export function d20Penalty(c: Creature): number {
  return 2 * (c.exhaustion ?? 0);
}

export interface RollFlags {
  advantage: boolean;
  disadvantage: boolean;
}

/** Advantage and disadvantage on an attack roll from both creatures' conditions. */
export function attackFlags(attacker: Creature, target: Creature, melee: boolean): RollFlags {
  const a = activeNames(attacker);
  const t = activeNames(target);
  let advantage = false;
  let disadvantage = false;

  // The attacker's own conditions.
  if (a.has('blinded') || a.has('poisoned') || a.has('prone') || a.has('restrained') || a.has('frightened')) disadvantage = true;
  if (a.has('invisible')) advantage = true; // targets are assumed not to see invisible creatures
  const grapplers = (attacker.conditions ?? []).filter((x) => x.name === 'grappled').map((x) => x.sourceId);
  if (grapplers.length > 0 && !grapplers.includes(target.id)) disadvantage = true;

  // The target's conditions.
  if (t.has('blinded') || t.has('paralyzed') || t.has('petrified') || t.has('restrained') || t.has('stunned') || t.has('unconscious')) {
    advantage = true;
  }
  if (t.has('prone')) {
    if (melee) advantage = true;
    else disadvantage = true;
  }
  if (t.has('invisible')) disadvantage = true;

  return { advantage, disadvantage };
}

/** A hit within 5 feet of a Paralyzed or Unconscious target is a critical hit. */
export function isAutoCrit(target: Creature, melee: boolean): boolean {
  if (!melee) return false;
  const t = activeNames(target);
  return t.has('paralyzed') || t.has('unconscious');
}

export interface SaveFlags extends RollFlags {
  autoFail: boolean;
}

/** Paralyzed, Petrified, Stunned and Unconscious creatures fail Str and Dex saves; Restrained has Dex disadvantage. */
export function saveFlags(c: Creature, ability: Ability): SaveFlags {
  const n = activeNames(c);
  const autoFail = (ability === 'str' || ability === 'dex') && (n.has('paralyzed') || n.has('petrified') || n.has('stunned') || n.has('unconscious'));
  return { autoFail, advantage: ability === 'dex' && hasDexSaveAdvantage(c), disadvantage: ability === 'dex' && n.has('restrained') };
}

/** Initiative: Advantage while Invisible, Disadvantage while Incapacitated. */
export function initiativeMode(c: Creature): RollMode {
  const n = activeNames(c);
  return resolveMode(n.has('invisible'), n.has('incapacitated'));
}

/** Petrified creatures resist all damage. */
export function defensesOf(c: Creature): Defenses {
  if (!hasCondition(c, 'petrified')) return c;
  return { resistances: DAMAGE_TYPES, vulnerabilities: c.vulnerabilities, immunities: c.immunities };
}

/** A Charmed creature cannot attack or target its charmer with damaging effects. */
export function cannotTarget(actor: Creature, target: Creature): boolean {
  return (actor.conditions ?? []).some((x) => x.name === 'charmed' && x.sourceId === target.id);
}

export function sizeAtMost(size: Size | undefined, max: Size): boolean {
  return SIZES.indexOf(size ?? 'medium') <= SIZES.indexOf(max);
}

/** A prone creature can stand (spending half its movement) unless something holds it in place. */
export function canStandUp(c: Creature): boolean {
  const n = activeNames(c);
  return !(n.has('grappled') || n.has('restrained') || n.has('paralyzed') || n.has('petrified') || n.has('unconscious'));
}

// ----- Applying and removing -----

export interface ApplyContext {
  /** The creature inflicting the condition. */
  sourceId?: string;
  /** The condition ends when this creature stops concentrating. */
  concentrationOf?: string;
  /** Whose turn it is right now (decides how "until the end of its next turn" is counted). */
  actorId?: string;
}

/**
 * Put a condition on a creature. Returns the new condition, or null if the creature is dead,
 * immune, too large for the effect, or Petrified (which is immune to Poisoned).
 */
export function applyCondition(target: Creature, effect: ConditionEffect, ctx: ApplyContext = {}): ActiveCondition | null {
  if (target.status === 'dead') return null;
  if (target.conditionImmunities?.includes(effect.condition)) return null;
  if (effect.condition === 'poisoned' && hasCondition(target, 'petrified')) return null;
  if (effect.maxSize && !sizeAtMost(target.size, effect.maxSize)) return null;

  const cond: ActiveCondition = {
    name: effect.condition,
    ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
    duration: effect.duration,
    ...(effect.repeatSave ? { repeatSave: effect.repeatSave } : {}),
    ...(effect.escapeDc ? { escapeDc: effect.escapeDc } : {}),
    ...(ctx.concentrationOf ? { concentrationOf: ctx.concentrationOf } : {}),
  };

  const d = effect.duration;
  if (d.kind === 'endOfTargetNextTurn') {
    cond.expires = { id: target.id, at: 'end', skip: ctx.actorId === target.id ? 1 : 0 };
  } else if (d.kind === 'startOfSourceNextTurn' && ctx.sourceId) {
    cond.expires = { id: ctx.sourceId, at: 'start', skip: 0 };
  } else if (d.kind === 'endOfSourceNextTurn' && ctx.sourceId) {
    cond.expires = { id: ctx.sourceId, at: 'end', skip: ctx.actorId === ctx.sourceId ? 1 : 0 };
  } else if (d.kind === 'rounds') {
    cond.roundsLeft = d.n;
  }

  // The same condition from the same source is refreshed rather than stacked.
  const list = (target.conditions ?? []).filter((x) => !(x.name === cond.name && x.sourceId === cond.sourceId));
  list.push(cond);
  target.conditions = list;
  return cond;
}

export function removeCondition(c: Creature, cond: ActiveCondition): void {
  c.conditions = (c.conditions ?? []).filter((x) => x !== cond);
}

/** Add exhaustion levels. Level 6 is death. Returns the new level. */
export function addExhaustion(c: Creature, levels = 1): number {
  c.exhaustion = Math.min(6, (c.exhaustion ?? 0) + levels);
  if (c.exhaustion >= 6 && c.status !== 'dead') {
    c.status = 'dead';
    c.hp = 0;
  }
  return c.exhaustion;
}

export interface Removal {
  creature: Creature;
  condition: ActiveCondition;
}

/** A turn boundary for creature `id`: remove conditions that expire now. */
export function expireAt(creatures: readonly Creature[], id: string, at: 'start' | 'end'): Removal[] {
  const removed: Removal[] = [];
  for (const creature of creatures) {
    for (const cond of [...(creature.conditions ?? [])]) {
      if (!cond.expires || cond.expires.id !== id || cond.expires.at !== at) continue;
      if (cond.expires.skip > 0) cond.expires.skip -= 1;
      else {
        removeCondition(creature, cond);
        removed.push({ creature, condition: cond });
      }
    }
  }
  return removed;
}

/** Start of a round: count down fixed-length conditions. */
export function tickRounds(creatures: readonly Creature[]): Removal[] {
  const removed: Removal[] = [];
  for (const creature of creatures) {
    for (const cond of [...(creature.conditions ?? [])]) {
      if (cond.roundsLeft === undefined) continue;
      cond.roundsLeft -= 1;
      if (cond.roundsLeft <= 0) {
        removeCondition(creature, cond);
        removed.push({ creature, condition: cond });
      }
    }
  }
  return removed;
}

/**
 * A grapple ends when the grappler is incapacitated or dead. Conditions that last only while
 * another one does (Restrained "until the grapple ends", Paralyzed "while Poisoned") go with it.
 */
export function releaseLinked(creatures: readonly Creature[]): Removal[] {
  const byId = new Map(creatures.map((c) => [c.id, c]));
  const removed: Removal[] = [];
  for (const creature of creatures) {
    for (const cond of [...(creature.conditions ?? [])]) {
      if (cond.name !== 'grappled' || !cond.sourceId) continue;
      const grappler = byId.get(cond.sourceId);
      if (!grappler || grappler.status === 'dead' || hasCondition(grappler, 'incapacitated')) {
        removeCondition(creature, cond);
        removed.push({ creature, condition: cond });
      }
    }
    // Repeat until nothing more falls away (a chain: A lasts while B, B lasts while C).
    for (let again = true; again; ) {
      again = false;
      for (const cond of [...(creature.conditions ?? [])]) {
        if (cond.duration.kind !== 'while') continue;
        const anchor = cond.duration.condition;
        const held = (creature.conditions ?? []).some((x) => x !== cond && x.name === anchor && x.sourceId === cond.sourceId);
        if (!held) {
          removeCondition(creature, cond);
          removed.push({ creature, condition: cond });
          again = true;
        }
      }
    }
  }
  return removed;
}
