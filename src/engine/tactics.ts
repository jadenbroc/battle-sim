import { armorClass, attackFlags, cannotTarget, d20Penalty, defensesOf, hasCondition, isAutoCrit, saveFlags } from './conditions';
import { rollModAverage } from './concentration';
import { damageFactor as factor, withChosenType } from './damage';
import { averageDice, parseDice, resolveMode, type RollMode } from './dice';
import type { Rng } from './rng';
import {
  attackSequence,
  hasUses,
  saveModifier,
  type Action,
  type AttackAction,
  type AttackOption,
  type BuffAction,
  type RollModifier,
  type Combatant,
  type Creature,
  type HealAction,
  type SaveAction,
  type SaveOption,
  type TargetProfile,
  type UseLimit,
} from './types';

/** Heal instead of attacking when an ally is below this fraction of max HP. */
export const HEAL_THRESHOLD = 0.3;

export type Plan =
  | { kind: 'attack'; action: AttackAction; target: Combatant }
  | { kind: 'save'; action: SaveAction; targets: Combatant[] }
  | { kind: 'heal'; action: HealAction; target: Combatant }
  | { kind: 'buff'; action: BuffAction; targets: Combatant[] };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Chance a d20 roll with this much advantage or disadvantage beats a single-roll chance `p`. */
function withMode(p: number, mode: RollMode): number {
  if (mode === 'advantage') return 1 - (1 - p) * (1 - p);
  if (mode === 'disadvantage') return p * p;
  return p;
}

function attackMode(a: AttackOption, target: Creature, attacker?: Creature): RollMode {
  if (!attacker) return 'normal';
  const flags = attackFlags(attacker, target, (a.range ?? 'melee') === 'melee');
  return resolveMode(flags.advantage, flags.disadvantage);
}

/** Chance an attack hits (a natural 20 always hits, a natural 1 always misses). */
export function attackHitChance(a: AttackOption, target: Creature, attacker?: Creature): number {
  if (a.autoHit) return 1;
  const bonus = a.toHit - (attacker ? d20Penalty(attacker) - rollModAverage(attacker, 'attack') : 0);
  return withMode(clamp((21 - (armorClass(target) - bonus)) / 20, 0.05, 0.95), attackMode(a, target, attacker));
}

/**
 * Expected damage of one attack roll: hit chance (nat 20 hits, nat 1 misses) and crit chance.
 * Pass the attacker to account for conditions (advantage, auto-crits, exhaustion).
 */
export function expectedAttackDamage(option: AttackOption, target: Creature, attacker?: Creature): number {
  const a = withChosenType(option, defensesOf(target));
  const melee = (a.range ?? 'melee') === 'melee';
  const pHit = attackHitChance(a, target, attacker);
  const mode = attackMode(a, target, attacker);
  const pCrit = a.autoHit ? 0 : isAutoCrit(target, melee) ? pHit : withMode(0.05, mode);
  let total = 0;
  for (const c of a.damage) {
    const expr = parseDice(c.dice);
    const avg = Math.max(0, averageDice(expr));
    const diceAvg = averageDice({ ...expr, modifier: 0 });
    total += (pHit * avg + pCrit * diceAvg) * factor(c.type, defensesOf(target));
  }
  return total;
}

/** Chance the target fails a save, counting auto-failure, disadvantage and exhaustion. */
export function saveFailChance(target: Creature, ability: SaveOption['ability'], dc: number): number {
  const sf = saveFlags(target, ability);
  if (sf.autoFail) return 1;
  const modifier = saveModifier(target, ability) - d20Penalty(target) + rollModAverage(target, 'save');
  const pSave = withMode(clamp((21 - (dc - modifier)) / 20, 0, 1), resolveMode(sf.advantage, sf.disadvantage));
  return 1 - pSave;
}

/** Expected damage of a save effect against one target. */
export function expectedSaveDamage(s: SaveOption, target: Creature): number {
  const pSave = 1 - saveFailChance(target, s.ability, s.dc);
  let full = 0;
  for (const c of s.damage) full += Math.max(0, averageDice(c.dice)) * factor(c.type, defensesOf(target));
  return (1 - pSave) * full + (s.halfOnSave ? (pSave * full) / 2 : 0);
}

/** Damage per round from the stat block alone (ignores the target's AC and saves). */
export function estimateDpr(c: Combatant): number {
  let best = 0;
  const avgOf = (parts: readonly { dice: string }[]): number =>
    parts.reduce((sum, p) => sum + Math.max(0, averageDice(p.dice)), 0);
  for (const a of c.actions) {
    const total = a.kind === 'attack' ? attackSequence(a).reduce((sum, o) => sum + avgOf(o.damage), 0) : avgOf(a.save.damage);
    best = Math.max(best, total);
  }
  return best;
}

interface SlotCost {
  name: string;
  spell?: string;
  slotLevel?: number;
  limit?: UseLimit;
}

/**
 * Options the creature can afford right now: slots available and uses left (recharge abilities
 * that have not recharged are out). For each spell, only the lowest affordable slot level is
 * kept, so casters never burn a higher slot than they need.
 */
export function usableOptions<T extends SlotCost>(
  options: readonly T[],
  slots: Record<number, number>,
  uses: Pick<Combatant, 'usesLeft'> = {},
): T[] {
  const best = new Map<string, T>();
  for (const o of options) {
    const level = o.slotLevel ?? 0;
    if (level > 0 && (slots[level] ?? 0) <= 0) continue;
    if (!hasUses(uses, o)) continue;
    const key = o.spell ?? o.name;
    const current = best.get(key);
    if (!current || level < (current.slotLevel ?? 0)) best.set(key, o);
  }
  return [...best.values()];
}

/** Conscious targets come first; downed characters are valid only when none remain. */
export function validTargets(enemies: readonly Combatant[]): Combatant[] {
  const conscious = enemies.filter((e) => e.creature.status === 'alive');
  if (conscious.length > 0) return conscious;
  return enemies.filter((e) => e.creature.status === 'down' || e.creature.status === 'stable');
}

/** Valid targets for this actor: a Charmed creature cannot target its charmer. */
export function targetsFor(actor: Combatant, enemies: readonly Combatant[]): Combatant[] {
  return validTargets(enemies.filter((e) => !cannotTarget(actor.creature, e.creature)));
}

export function chooseTarget(profile: TargetProfile, candidates: readonly Combatant[], rng: Rng): Combatant | null {
  if (candidates.length === 0) return null;
  if (profile === 'random') return candidates[rng.int(0, candidates.length - 1)]!;

  let best = candidates[0]!;
  for (const c of candidates.slice(1)) {
    if (profile === 'weakest') {
      if (c.creature.hp < best.creature.hp) best = c;
    } else {
      const d = estimateDpr(c) - estimateDpr(best);
      if (d > 0 || (d === 0 && c.creature.hp < best.creature.hp)) best = c;
    }
  }
  return best;
}

/** Which of a turn's two slots an option is for. */
export type Slot = 'action' | 'bonus';

const inSlot = (o: { bonus?: boolean }, slot: Slot): boolean => !!o.bonus === (slot === 'bonus');

function planHeal(actor: Combatant, allies: readonly Combatant[], slot: Slot): Plan | null {
  const heals = usableOptions(
    actor.heals.filter((h) => inSlot(h, slot)),
    actor.slots,
    actor,
  );
  if (heals.length === 0) return null;

  const needy = allies
    .filter((a) => a.creature.status !== 'dead' && a.creature.hp < a.creature.maxHp * HEAL_THRESHOLD)
    .sort((a, b) => {
      const downedA = a.creature.status === 'alive' ? 1 : 0;
      const downedB = b.creature.status === 'alive' ? 1 : 0;
      return downedA - downedB || a.creature.hp / a.creature.maxHp - b.creature.hp / b.creature.maxHp;
    });
  const target = needy[0];
  if (!target) return null;

  const action = heals.reduce((a, b) => (averageDice(b.dice) > averageDice(a.dice) ? b : a));
  return { kind: 'heal', action, target };
}

/**
 * Expected damage of an action against its targets, counting both creatures' conditions
 * (advantage, automatic crits, exhaustion). The conditions an action would inflict are not scored:
 * they still apply when the action is used, but choosing a weaker attack for the chance of a
 * condition made monsters worse in testing (a Ghoul that claws for paralysis instead of biting).
 */
function expectedFor(action: Action, targets: readonly Combatant[], primary: Combatant, actor: Combatant, rounds: number): number {
  if (action.kind === 'attack') {
    const base = attackSequence(action).reduce((sum, a) => sum + expectedAttackDamage(a, primary.creature, actor.creature), 0);
    if (!action.leap) return base;
    // Each leap needs the previous attack to hit and the dice to match; a leap is valued like a repeat of the attack.
    const p = attackHitChance(action.attack, primary.creature, actor.creature) * action.leap.chance;
    const each = expectedAttackDamage(action.attack, primary.creature, actor.creature);
    let extra = 0;
    for (let k = 1, reach = p; k <= action.leap.max; k++, reach *= p) extra += reach * each;
    return base + extra;
  }
  const hit = action.area ? targets : [primary];
  return hit.reduce((sum, t) => sum + expectedSaveDamage(action.save, t.creature) + rollModifierValue(action.save, t, rounds), 0);
}

/** How many rounds a lasting effect is assumed to matter at most (it ends with the fight). */
export const MODIFIER_HORIZON = 3;

/**
 * How many rounds a concentration effect is expected to last: each round it survives with the chance that the
 * caster is not hit, or is hit and keeps concentrating (a Constitution save against the minimum DC of 10).
 * With no risk it is `MODIFIER_HORIZON` rounds. A caster who is likely to be hit buffs less.
 */
function lastingRounds(actor: Combatant, allies: readonly Combatant[], enemies: readonly Combatant[]): number {
  const up = allies.filter((a) => a.creature.status === 'alive').length || 1;
  const foes = enemies.filter((e) => e.creature.status === 'alive').length;
  const pHit = clamp((foes / up) * 0.6, 0, 1);
  const pHold = clamp((saveModifier(actor.creature, 'con') + 11) / 20, 0, 1);
  const keeps = 1 - pHit * (1 - pHold);
  let rounds = 0;
  for (let k = 1, p = keeps; k <= MODIFIER_HORIZON; k++, p *= keeps) rounds += p;
  return rounds;
}

/** Haste's lethargy costs a lost turn, but only if the spell ends before the fight does: about half the time. */
const LETHARGY_RISK = 0.5;

/** Assumed chance that an extra weapon attack hits. */
const EXTRA_ATTACK_HIT = 0.6;

/**
 * What a roll penalty is worth in damage: the target fails the save, then its attacks hit less often
 * (the average penalty out of 20) for a few rounds, so it deals that share less of its damage per round.
 * Only the attack part is valued; the penalty on its saves is a bonus on top.
 */
function rollModifierValue(s: SaveOption, target: Combatant, rounds: number): number {
  const m = s.rollModifier;
  if (!m || !m.attacks || m.sign > 0 || !m.dice) return 0;
  if (target.creature.rollMods?.some((x) => x.name === s.name)) return 0;
  const swing = averageDice(m.dice) / 20;
  return saveFailChance(target.creature, s.ability, s.dc) * swing * estimateDpr(target) * rounds;
}

/** A creature's plain weapon attacks: not spells, not limited, not bonus actions. */
function weaponAttacks(c: Combatant): AttackAction[] {
  return c.actions.filter((a): a is AttackAction => a.kind === 'attack' && !a.slotLevel && !a.spell && !a.limit && !a.bonus);
}

/** Average damage of one hit of the creature's best weapon attack. */
function bestWeaponHit(c: Combatant): number {
  return weaponAttacks(c).reduce((best, a) => Math.max(best, a.attack.damage.reduce((sum, d) => sum + Math.max(0, averageDice(d.dice)), 0)), 0);
}

/** Damage an ally is expected to take per round: the enemies' damage spread over the party. */
function incomingPerRound(allies: readonly Combatant[], enemies: readonly Combatant[]): number {
  const up = allies.filter((a) => a.creature.status === 'alive').length || 1;
  return enemies.filter((e) => e.creature.status === 'alive').reduce((sum, e) => sum + estimateDpr(e), 0) / up;
}

/**
 * What a buff is worth to one ally, in damage: per round, the bonus die adds its average out of 20 to the
 * ally's hit chance, an AC bonus takes that much off the enemies' hit chance, and an extra attack is a
 * weapon hit at a typical hit chance; over a few rounds. Haste's lethargy is subtracted.
 */
function buffValue(m: Omit<RollModifier, 'name'>, ally: Combatant, allies: readonly Combatant[], enemies: readonly Combatant[], rounds: number): number {
  let perRound = 0;
  if (m.dice && m.attacks && m.sign > 0) perRound += (averageDice(m.dice) / 20) * estimateDpr(ally);
  if (m.acBonus) perRound += (m.acBonus / 20) * incomingPerRound(allies, enemies);
  if (m.extraAttack) perRound += bestWeaponHit(ally) * EXTRA_ATTACK_HIT;
  let value = perRound * rounds;
  if (m.endsWith?.condition === 'incapacitated') value -= LETHARGY_RISK * estimateDpr(ally);
  return value;
}

/**
 * Cast a buff (Bless, Shield of Faith, Haste) on the allies who gain the most. Returns the best buff and
 * its value, or null when there is nobody left worth buffing.
 */
function planBuff(actor: Combatant, allies: readonly Combatant[], enemies: readonly Combatant[], slot: Slot): { plan: Plan; score: number } | null {
  const usable = usableOptions(
    (actor.buffs ?? []).filter((b) => inSlot(b, slot) && !(b.concentration && actor.creature.concentrating)),
    actor.slots,
    actor,
  );
  let best: { plan: Plan; score: number } | null = null;
  const rounds = lastingRounds(actor, allies, enemies);
  for (const action of usable) {
    const gains = allies
      .filter((a) => a.creature.status === 'alive' && !a.creature.rollMods?.some((x) => x.name === (action.spell ?? action.name) && x.sourceId === actor.creature.id))
      .map((a) => ({ ally: a, value: buffValue(action.rollModifier, a, allies, enemies, rounds) }))
      .filter((g) => g.value > 0)
      // The same value (an AC bonus is worth the same to everyone): the one closest to falling.
      .sort((x, y) => y.value - x.value || x.ally.creature.hp - y.ally.creature.hp)
      .slice(0, action.maxTargets);
    const score = gains.reduce((sum, g) => sum + g.value, 0);
    if (gains.length === 0) continue;
    if (!best || score > best.score) best = { plan: { kind: 'buff', action, targets: gains.map((g) => g.ally) }, score };
  }
  return best;
}

/** Haste's additional action: one attack with the best weapon attack against a target. */
export function planExtraAttack(actor: Combatant, fighters: readonly Combatant[], rng: Rng): Plan | null {
  if (!(actor.creature.rollMods ?? []).some((m) => m.extraAttack)) return null;
  const target = chooseTarget(actor.profile, targetsFor(actor, fighters.filter((f) => f.team !== actor.team)), rng);
  if (!target) return null;
  let best: AttackAction | null = null;
  let bestScore = -1;
  for (const a of weaponAttacks(actor)) {
    const score = expectedAttackDamage(a.attack, target.creature, actor.creature);
    if (score > bestScore) {
      best = { kind: 'attack', name: a.name, attack: a.attack };
      bestScore = score;
    }
  }
  return best ? { kind: 'attack', action: best, target } : null;
}
/**
 * Decide what one creature does with its action or bonus action: heal if an ally is low, else
 * the best damage option. Returns null when it has nothing usable (common for bonus actions).
 */
export function planTurn(
  actor: Combatant,
  fighters: readonly Combatant[],
  rng: Rng,
  areaTargets: number,
  slot: Slot = 'action',
): Plan | null {
  const allies = fighters.filter((f) => f.team === actor.team);
  const enemies = fighters.filter((f) => f.team !== actor.team);

  const heal = planHeal(actor, allies, slot);
  if (heal) return heal;

  const candidates = targetsFor(actor, enemies);
  const primary = chooseTarget(actor.profile, candidates, rng);
  if (!primary) return null;

  let best: { action: Action; targets: Combatant[]; primary: Combatant; score: number } | null = null;
  const rounds = lastingRounds(actor, allies, enemies);
  // A creature already concentrating does not start another concentration spell (it would lose the first).
  const options = usableOptions(
    actor.actions.filter((a) => inSlot(a, slot) && !(a.concentration && actor.creature.concentrating)),
    actor.slots,
    actor,
  );
  for (const action of options) {
    // Some actions only work on a target in a given condition (Trample needs a Prone target).
    const need = action.targetRequires;
    const pool = need ? candidates.filter((t) => hasCondition(t.creature, need)) : candidates;
    if (pool.length === 0) continue;
    const target = need ? chooseTarget(actor.profile, pool, rng)! : primary;

    const cap = action.kind === 'save' && action.area ? Math.min(areaTargets, action.maxTargets ?? Infinity) : 1;
    const areaList = [...pool].sort((a, b) => b.creature.hp - a.creature.hp);
    const targets = action.kind === 'save' && action.area ? areaList.slice(0, Math.max(1, cap)) : [target];
    const score = expectedFor(action, targets, target, actor, rounds);
    if (!best || score > best.score) best = { action, targets, primary: target, score };
  }
  // A buff is cast when it is worth more than the best attack (Bless over a cantrip, not over a big spell).
  const buff = planBuff(actor, allies, enemies, slot);
  if (buff && (!best || buff.score > best.score)) return buff.plan;
  if (!best) return null;

  return best.action.kind === 'attack'
    ? { kind: 'attack', action: best.action, target: best.primary }
    : { kind: 'save', action: best.action, targets: best.targets };
}
