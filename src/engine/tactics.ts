import { averageDice, parseDice } from './dice';
import type { Rng } from './rng';
import {
  saveModifier,
  type Action,
  type AttackAction,
  type AttackOption,
  type Combatant,
  type Creature,
  type Defenses,
  type DamageType,
  type HealAction,
  type SaveAction,
  type SaveOption,
  type TargetProfile,
} from './types';

/** Heal instead of attacking when an ally is below this fraction of max HP. */
export const HEAL_THRESHOLD = 0.3;

export type Plan =
  | { kind: 'attack'; action: AttackAction; target: Combatant }
  | { kind: 'save'; action: SaveAction; targets: Combatant[] }
  | { kind: 'heal'; action: HealAction; target: Combatant };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function factor(type: DamageType, d: Defenses): number {
  if (d.immunities.includes(type)) return 0;
  return (d.resistances.includes(type) ? 0.5 : 1) * (d.vulnerabilities.includes(type) ? 2 : 1);
}

/** Expected damage of one attack roll: hit chance (nat 20 hits, nat 1 misses) and crit chance. */
export function expectedAttackDamage(a: AttackOption, target: Creature): number {
  const pHit = clamp((21 - (target.ac - a.toHit)) / 20, 0.05, 0.95);
  let total = 0;
  for (const c of a.damage) {
    const expr = parseDice(c.dice);
    const avg = Math.max(0, averageDice(expr));
    const diceAvg = averageDice({ ...expr, modifier: 0 });
    total += (pHit * avg + 0.05 * diceAvg) * factor(c.type, target);
  }
  return total;
}

/** Expected damage of a save effect against one target. */
export function expectedSaveDamage(s: SaveOption, target: Creature): number {
  const pSave = clamp((21 - (s.dc - saveModifier(target, s.ability))) / 20, 0, 1);
  let full = 0;
  for (const c of s.damage) full += Math.max(0, averageDice(c.dice)) * factor(c.type, target);
  return (1 - pSave) * full + (s.halfOnSave ? (pSave * full) / 2 : 0);
}

/** Damage per round from the stat block alone (ignores the target's AC and saves). */
export function estimateDpr(c: Combatant): number {
  let best = 0;
  for (const a of c.actions) {
    const parts = a.kind === 'attack' ? a.attack.damage : a.save.damage;
    const avg = parts.reduce((sum, p) => sum + Math.max(0, averageDice(p.dice)), 0);
    best = Math.max(best, a.kind === 'attack' ? avg * (a.count ?? 1) : avg);
  }
  return best;
}

interface SlotCost {
  name: string;
  spell?: string;
  slotLevel?: number;
}

/**
 * Options the creature can afford right now. For each spell, only the lowest affordable slot
 * level is kept, so casters never burn a higher slot than they need.
 */
export function usableOptions<T extends SlotCost>(options: readonly T[], slots: Record<number, number>): T[] {
  const best = new Map<string, T>();
  for (const o of options) {
    const level = o.slotLevel ?? 0;
    if (level > 0 && (slots[level] ?? 0) <= 0) continue;
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

function planHeal(actor: Combatant, allies: readonly Combatant[]): Plan | null {
  const heals = usableOptions(actor.heals, actor.slots);
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

function expectedFor(action: Action, targets: readonly Combatant[], primary: Combatant): number {
  if (action.kind === 'attack') return expectedAttackDamage(action.attack, primary.creature) * (action.count ?? 1);
  if (!action.area) return expectedSaveDamage(action.save, primary.creature);
  return targets.reduce((sum, t) => sum + expectedSaveDamage(action.save, t.creature), 0);
}

/** Decide what one creature does on its turn: heal if an ally is low, else the best damage option. */
export function planTurn(actor: Combatant, fighters: readonly Combatant[], rng: Rng, areaTargets: number): Plan | null {
  const allies = fighters.filter((f) => f.team === actor.team);
  const enemies = fighters.filter((f) => f.team !== actor.team);

  const heal = planHeal(actor, allies);
  if (heal) return heal;

  const candidates = validTargets(enemies);
  const primary = chooseTarget(actor.profile, candidates, rng);
  if (!primary) return null;

  const areaList = [...candidates].sort((a, b) => b.creature.hp - a.creature.hp);

  let best: { action: Action; targets: Combatant[]; score: number } | null = null;
  for (const action of usableOptions(actor.actions, actor.slots)) {
    const cap = action.kind === 'save' && action.area ? Math.min(areaTargets, action.maxTargets ?? Infinity) : 1;
    const targets = action.kind === 'save' && action.area ? areaList.slice(0, Math.max(1, cap)) : [primary];
    const score = expectedFor(action, targets, primary);
    if (!best || score > best.score) best = { action, targets, score };
  }
  if (!best) return null;

  return best.action.kind === 'attack'
    ? { kind: 'attack', action: best.action, target: primary }
    : { kind: 'save', action: best.action, targets: best.targets };
}
