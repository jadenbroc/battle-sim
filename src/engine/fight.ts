import {
  activeNames,
  canAct,
  canStandUp,
  d20Penalty,
  expireAt,
  initiativeMode,
  releaseLinked,
  removeCondition,
  tickRounds,
  type Removal,
} from './conditions';
import { creatureSave, performAttack, performSave, type AttackEvent, type SaveEvent } from './combat';
import { concentrationDc, mustStop, releaseConcentration, tickRollMods, type ConcentrationEndReason, type Released } from './concentration';
import { rollD20, rollDice } from './dice';
import { heal, rollDeathSave, type DeathSaveResult } from './hp';
import type { Rng } from './rng';
import { chooseTarget, planTurn, targetsFor, type Plan } from './tactics';
import {
  abilityMod,
  attackSequence,
  hasUses,
  initialUses,
  type Combatant,
  type ConditionName,
  type UseLimit,
} from './types';

export interface FightOptions {
  /** Max enemies an area spell hits when there is no grid. */
  areaTargets: number;
  /** Identical monsters (same groupKey) share one initiative roll. */
  groupInitiative: boolean;
  /** Fights reaching this many rounds count as a stalemate. */
  roundCap: number;
}

export const DEFAULT_OPTIONS: FightOptions = { areaTargets: 3, groupInitiative: false, roundCap: 30 };

export interface FightConfig {
  combatants: Combatant[];
  options?: Partial<FightOptions>;
}

export type Outcome = 'won-clean' | 'won-deaths' | 'tpk' | 'stalemate';

export type ConditionEndReason = 'expired' | 'released' | 'stood-up';

export type LogEvent =
  | { kind: 'initiative'; order: { id: string; name: string; total: number }[] }
  | { kind: 'round-start'; round: number }
  | AttackEvent
  | SaveEvent
  | { kind: 'heal'; actor: string; target: string; option: string; amount: number }
  | ({ kind: 'death-save'; actor: string } & DeathSaveResult)
  | { kind: 'recharge'; actor: string; option: string; roll: number; success: boolean }
  | { kind: 'condition-end'; target: string; condition: ConditionName; reason: ConditionEndReason }
  | { kind: 'concentration-start'; actor: string; spell: string; replaced?: string }
  | { kind: 'concentration-check'; actor: string; spell: string; damage: number; dc: number; roll: number; autoFail: boolean; success: boolean }
  | { kind: 'concentration-end'; actor: string; spell: string; reason: ConcentrationEndReason; released: Released[] }
  | { kind: 'modifier-end'; target: string; name: string }
  | { kind: 'repeat-save'; actor: string; condition: ConditionName; roll: number; dc: number; autoFail: boolean; success: boolean }
  | { kind: 'escape'; actor: string; roll: number; dc: number; success: boolean }
  | { kind: 'skip'; actor: string; reason: string }
  | { kind: 'no-action'; actor: string }
  | { kind: 'end'; outcome: Outcome; rounds: number };

export interface LoggedEvent {
  round: number;
  event: LogEvent;
}

export interface FighterStats {
  id: string;
  name: string;
  team: Combatant['team'];
  damageDealt: number;
  survived: boolean;
}

export interface FightResult {
  outcome: Outcome;
  rounds: number;
  stats: FighterStats[];
  log: LoggedEvent[];
}

interface Rolled {
  fighter: Combatant;
  total: number;
}

/**
 * Roll initiative (d20 + Dex check modifier). Ties go to the higher Dex score, then a coin flip.
 * Invisible creatures roll with advantage and Incapacitated ones with disadvantage; Exhaustion
 * applies. Returns fighters in turn order.
 */
export function rollInitiative(rng: Rng, fighters: readonly Combatant[], group: boolean): Rolled[] {
  const groupRolls = new Map<string, number>();
  const rolled = fighters.map((fighter) => {
    const mod = abilityMod(fighter.creature.abilityScores.dex) + (fighter.initiativeBonus ?? 0) - d20Penalty(fighter.creature);
    const key = group && fighter.groupKey ? fighter.groupKey : null;
    let natural: number;
    if (key !== null && groupRolls.has(key)) natural = groupRolls.get(key)!;
    else {
      natural = rollD20(rng, 0, initiativeMode(fighter.creature)).natural;
      if (key !== null) groupRolls.set(key, natural);
    }
    return { fighter, total: natural + mod, coin: rng.next() };
  });
  rolled.sort(
    (a, b) =>
      b.total - a.total ||
      b.fighter.creature.abilityScores.dex - a.fighter.creature.abilityScores.dex ||
      a.coin - b.coin,
  );
  return rolled.map(({ fighter, total }) => ({ fighter, total }));
}

function checkEnd(fighters: readonly Combatant[]): Outcome | null {
  const party = fighters.filter((f) => f.team === 'party');
  const enemies = fighters.filter((f) => f.team === 'enemies');
  if (enemies.every((e) => e.creature.status !== 'alive')) {
    return party.some((p) => p.creature.status === 'dead') ? 'won-deaths' : 'won-clean';
  }
  if (party.every((p) => p.creature.status !== 'alive')) return 'tpk';
  return null;
}

/** Pay for an action: a spell slot and/or one use of a limited ability. */
function spend(actor: Combatant, action: { name: string; slotLevel?: number; limit?: UseLimit }): void {
  const level = action.slotLevel ?? 0;
  if (level > 0) actor.slots[level] = (actor.slots[level] ?? 0) - 1;
  if (action.limit) {
    const left = actor.usesLeft?.[action.name] ?? initialUses(action.limit);
    actor.usesLeft = { ...actor.usesLeft, [action.name]: left - 1 };
  }
}

/** Run one fight to completion. Works on a copy of the config, so it can be rerun. */
export function runFight(config: FightConfig, rng: Rng, opts: { log?: boolean } = {}): FightResult {
  const options: FightOptions = { ...DEFAULT_OPTIONS, ...config.options };
  const fighters = structuredClone(config.combatants);
  if (!fighters.some((f) => f.team === 'party') || !fighters.some((f) => f.team === 'enemies')) {
    throw new Error('A fight needs at least one party member and one enemy');
  }
  const creatures = fighters.map((f) => f.creature);

  const log: LoggedEvent[] = [];
  const push = (round: number, event: LogEvent): void => {
    if (opts.log) log.push({ round, event });
  };
  const damage = new Map(fighters.map((f) => [f.creature.id, 0]));
  const addDamage = (actor: Combatant, amount: number): void => {
    damage.set(actor.creature.id, (damage.get(actor.creature.id) ?? 0) + amount);
  };

  const order = rollInitiative(rng, fighters, options.groupInitiative);
  push(0, {
    kind: 'initiative',
    order: order.map((o) => ({ id: o.fighter.creature.id, name: o.fighter.creature.name, total: o.total })),
  });

  const logRemovals = (round: number, removed: readonly Removal[], reason: ConditionEndReason): void => {
    for (const r of removed) push(round, { kind: 'condition-end', target: r.creature.name, condition: r.condition.name, reason });
  };

  /** Stop a creature's concentration, ending everything the spell was doing. */
  const stopConcentrating = (round: number, caster: Combatant, reason: ConcentrationEndReason): void => {
    const spell = caster.creature.concentrating;
    if (!spell) return;
    const released = releaseConcentration(creatures, caster.creature);
    push(round, { kind: 'concentration-end', actor: caster.creature.name, spell, reason, released });
    logRemovals(round, releaseLinked(creatures), 'released');
  };

  /** Anyone concentrating who has been knocked out, killed or made Incapacitated loses the spell. */
  const sweepConcentration = (round: number): void => {
    for (const f of fighters) {
      const why = f.creature.concentrating ? mustStop(f.creature) : null;
      if (why) stopConcentrating(round, f, why);
    }
  };

  /** A concentrating creature that took damage and is still up makes a Constitution save to keep the spell. */
  const concentrationCheck = (round: number, target: Combatant, damageTaken: number): void => {
    const c = target.creature;
    if (!c.concentrating || damageTaken <= 0 || c.status !== 'alive') return;
    const dc = concentrationDc(damageTaken);
    const r = creatureSave(rng, c, 'con', dc);
    push(round, { kind: 'concentration-check', actor: c.name, spell: c.concentrating, damage: damageTaken, dc, roll: r.roll.total, autoFail: r.autoFail, success: r.success });
    if (!r.success) stopConcentrating(round, target, 'failed-save');
  };

  /** Casting a concentration spell: the caster concentrates on it, dropping any earlier spell. */
  const beginConcentration = (round: number, actor: Combatant, action: { name: string; spell?: string; concentration?: true }): void => {
    if (!action.concentration) return;
    const replaced = actor.creature.concentrating;
    if (replaced) stopConcentrating(round, actor, 'replaced');
    const spell = action.spell ?? action.name;
    actor.creature.concentrating = spell;
    push(round, { kind: 'concentration-start', actor: actor.creature.name, spell, ...(replaced ? { replaced } : {}) });
  };

  const execute = (round: number, actor: Combatant, plan: Plan): void => {
    if (plan.kind === 'heal') {
      spend(actor, plan.action);
      const amount = heal(plan.target.creature, Math.max(0, rollDice(rng, plan.action.dice).total));
      push(round, { kind: 'heal', actor: actor.creature.name, target: plan.target.creature.name, option: plan.action.name, amount });
      return;
    }

    if (plan.kind === 'save') {
      spend(actor, plan.action);
      beginConcentration(round, actor, plan.action);
      for (const target of plan.targets) {
        const e = performSave(rng, actor.creature, plan.action.save, target.creature);
        addDamage(actor, e.totalDamage);
        push(round, e);
        concentrationCheck(round, target, e.totalDamage);
      }
      logRemovals(round, releaseLinked(creatures), 'released');
      sweepConcentration(round);
      return;
    }

    spend(actor, plan.action);
    beginConcentration(round, actor, plan.action);
    const enemies = fighters.filter((f) => f.team !== actor.team);
    const attacks = attackSequence(plan.action);
    let struck = false;
    for (let i = 0; i < attacks.length; i++) {
      if (checkEnd(fighters)) break;
      const target = i === 0 ? plan.target : chooseTarget(actor.profile, targetsFor(actor, enemies), rng);
      if (!target) break;
      const e = performAttack(rng, actor.creature, attacks[i]!, target.creature);
      addDamage(actor, e.totalDamage);
      push(round, e);
      concentrationCheck(round, target, e.totalDamage);
      struck = e.attackRoll.hit;
    }
    // A leaping attack (Chromatic Orb): after a hit it may jump to a different enemy and attack again.
    const leap = plan.action.leap;
    if (leap) {
      const done = new Set([plan.target.creature.id]);
      for (let k = 0; struck && k < leap.max && !checkEnd(fighters); k++) {
        if (rng.next() >= leap.chance) break;
        const next = chooseTarget(actor.profile, targetsFor(actor, enemies).filter((f) => !done.has(f.creature.id)), rng);
        if (!next) break;
        done.add(next.creature.id);
        const e = performAttack(rng, actor.creature, plan.action.attack, next.creature);
        addDamage(actor, e.totalDamage);
        push(round, e);
        concentrationCheck(round, next, e.totalDamage);
        struck = e.attackRoll.hit;
      }
    }
    sweepConcentration(round);
    logRemovals(round, releaseLinked(creatures), 'released');
  };

  /** A creature that is both Grappled and Restrained by the grapple spends its action trying to escape. */
  const tryEscape = (round: number, actor: Combatant): boolean => {
    const c = actor.creature;
    const grapple = (c.conditions ?? []).find((x) => x.name === 'grappled' && x.escapeDc);
    const pinned = (c.conditions ?? []).some((x) => x.duration.kind === 'while' && x.duration.condition === 'grappled' && x.name === 'restrained');
    if (!grapple || !pinned) return false;

    // Strength (Athletics) or Dexterity (Acrobatics) check: the better ability modifier.
    const mod = Math.max(abilityMod(c.abilityScores.str), abilityMod(c.abilityScores.dex)) - d20Penalty(c);
    const roll = rollD20(rng, mod);
    const success = roll.total >= grapple.escapeDc!;
    push(round, { kind: 'escape', actor: c.name, roll: roll.total, dc: grapple.escapeDc!, success });
    if (success) {
      removeCondition(c, grapple);
      logRemovals(round, releaseLinked(creatures), 'released');
    }
    return true;
  };

  /** End of a creature's turn: repeat saves against its conditions, then end-of-turn expiries. */
  const endOfTurn = (round: number, actor: Combatant): void => {
    const c = actor.creature;
    for (const cond of [...(c.conditions ?? [])]) {
      if (!cond.repeatSave) continue;
      const r = creatureSave(rng, c, cond.repeatSave.ability, cond.repeatSave.dc);
      push(round, {
        kind: 'repeat-save',
        actor: c.name,
        condition: cond.name,
        roll: r.roll.total,
        dc: cond.repeatSave.dc,
        autoFail: r.autoFail,
        success: r.success,
      });
      if (r.success) removeCondition(c, cond);
    }
    logRemovals(round, expireAt(creatures, c.id, 'end'), 'expired');
    logRemovals(round, releaseLinked(creatures), 'released');
  };

  let outcome: Outcome | null = null;
  let round = 0;
  while (!outcome && round < options.roundCap) {
    round++;
    push(round, { kind: 'round-start', round });
    logRemovals(round, tickRounds(creatures), 'expired');
    for (const m of tickRollMods(creatures)) push(round, { kind: 'modifier-end', target: m.target, name: m.condition });

    for (const { fighter: actor } of order) {
      const c = actor.creature;
      if (c.status === 'dead' || c.status === 'stable') continue;

      logRemovals(round, expireAt(creatures, c.id, 'start'), 'expired');

      if (c.status === 'down') {
        const result = rollDeathSave(rng, c);
        push(round, { kind: 'death-save', actor: c.name, ...result });
      } else {
        // A prone creature stands up (spending half its movement) unless something pins it down.
        const prone = (c.conditions ?? []).filter((x) => x.name === 'prone');
        if (prone.length > 0 && canStandUp(c)) {
          for (const p of prone) removeCondition(c, p);
          push(round, { kind: 'condition-end', target: c.name, condition: 'prone', reason: 'stood-up' });
        }

        // Recharge abilities that are spent roll a d6 at the start of the creature's turn.
        for (const a of actor.actions) {
          if (a.limit?.kind !== 'recharge' || hasUses(actor, a)) continue;
          const roll = rng.die(6);
          const success = roll >= a.limit.min;
          if (success) actor.usesLeft = { ...actor.usesLeft, [a.name]: 1 };
          push(round, { kind: 'recharge', actor: c.name, option: a.name, roll, success });
        }

        if (!canAct(c)) {
          const why = [...activeNames(c)].filter((n) => ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'].includes(n));
          push(round, { kind: 'skip', actor: c.name, reason: why.filter((n) => n !== 'incapacitated').join(', ') || 'incapacitated' });
        } else {
          const escaped = tryEscape(round, actor);
          const plan = escaped ? null : planTurn(actor, fighters, rng, options.areaTargets, 'action');
          if (plan) execute(round, actor, plan);
          const bonus = checkEnd(fighters) ? null : planTurn(actor, fighters, rng, options.areaTargets, 'bonus');
          if (bonus) execute(round, actor, bonus);
          if (!escaped && !plan && !bonus) push(round, { kind: 'no-action', actor: c.name });
        }
      }

      endOfTurn(round, actor);
      sweepConcentration(round);
      outcome = checkEnd(fighters);
      if (outcome) break;
    }
  }

  const final: Outcome = outcome ?? 'stalemate';
  push(round, { kind: 'end', outcome: final, rounds: round });

  return {
    outcome: final,
    rounds: round,
    log,
    stats: fighters.map((f) => ({
      id: f.creature.id,
      name: f.creature.name,
      team: f.team,
      damageDealt: damage.get(f.creature.id) ?? 0,
      survived: f.creature.status !== 'dead',
    })),
  };
}
