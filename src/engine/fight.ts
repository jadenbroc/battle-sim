import { rollD20 } from './dice';
import { performAttack, performSave, type AttackEvent, type SaveEvent } from './combat';
import { rollDice } from './dice';
import { heal, rollDeathSave, type DeathSaveResult } from './hp';
import type { Rng } from './rng';
import { chooseTarget, planTurn, validTargets, type Plan } from './tactics';
import { abilityMod, attackSequence, hasUses, initialUses, type Combatant, type UseLimit } from './types';

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

export type LogEvent =
  | { kind: 'initiative'; order: { id: string; name: string; total: number }[] }
  | { kind: 'round-start'; round: number }
  | AttackEvent
  | SaveEvent
  | { kind: 'heal'; actor: string; target: string; option: string; amount: number }
  | ({ kind: 'death-save'; actor: string } & DeathSaveResult)
  | { kind: 'recharge'; actor: string; option: string; roll: number; success: boolean }
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
 * Returns fighters in turn order.
 */
export function rollInitiative(rng: Rng, fighters: readonly Combatant[], group: boolean): Rolled[] {
  const groupRolls = new Map<string, number>();
  const rolled = fighters.map((fighter) => {
    const mod = abilityMod(fighter.creature.abilityScores.dex) + (fighter.initiativeBonus ?? 0);
    const key = group && fighter.groupKey ? fighter.groupKey : null;
    let natural: number;
    if (key !== null && groupRolls.has(key)) natural = groupRolls.get(key)!;
    else {
      natural = rollD20(rng).natural;
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

  const execute = (round: number, actor: Combatant, plan: Plan): void => {
    if (plan.kind === 'heal') {
      spend(actor, plan.action);
      const amount = heal(plan.target.creature, Math.max(0, rollDice(rng, plan.action.dice).total));
      push(round, { kind: 'heal', actor: actor.creature.name, target: plan.target.creature.name, option: plan.action.name, amount });
      return;
    }

    if (plan.kind === 'save') {
      spend(actor, plan.action);
      for (const target of plan.targets) {
        const e = performSave(rng, actor.creature, plan.action.save, target.creature);
        addDamage(actor, e.totalDamage);
        push(round, e);
      }
      return;
    }

    spend(actor, plan.action);
    const enemies = fighters.filter((f) => f.team !== actor.team);
    const attacks = attackSequence(plan.action);
    for (let i = 0; i < attacks.length; i++) {
      if (checkEnd(fighters)) break;
      const target = i === 0 ? plan.target : chooseTarget(actor.profile, validTargets(enemies), rng);
      if (!target) break;
      const e = performAttack(rng, actor.creature, attacks[i]!, target.creature);
      addDamage(actor, e.totalDamage);
      push(round, e);
    }
  };

  let outcome: Outcome | null = null;
  let round = 0;
  while (!outcome && round < options.roundCap) {
    round++;
    push(round, { kind: 'round-start', round });

    for (const { fighter: actor } of order) {
      const c = actor.creature;
      if (c.status === 'dead' || c.status === 'stable') continue;

      if (c.status === 'down') {
        const result = rollDeathSave(rng, c);
        push(round, { kind: 'death-save', actor: c.name, ...result });
      } else {
        // Recharge abilities that are spent roll a d6 at the start of the creature's turn.
        for (const a of actor.actions) {
          if (a.limit?.kind !== 'recharge' || hasUses(actor, a)) continue;
          const roll = rng.die(6);
          const success = roll >= a.limit.min;
          if (success) actor.usesLeft = { ...actor.usesLeft, [a.name]: 1 };
          push(round, { kind: 'recharge', actor: c.name, option: a.name, roll, success });
        }

        const plan = planTurn(actor, fighters, rng, options.areaTargets, 'action');
        if (plan) execute(round, actor, plan);
        const bonus = checkEnd(fighters) ? null : planTurn(actor, fighters, rng, options.areaTargets, 'bonus');
        if (bonus) execute(round, actor, bonus);
        if (!plan && !bonus) push(round, { kind: 'no-action', actor: c.name });
      }

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
