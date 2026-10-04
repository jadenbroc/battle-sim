import { rollDice, averageDice } from './dice';
import { hasCondition, removeCondition } from './conditions';
import type { Rng } from './rng';
import type { ActiveRollMod, ConditionEffect, Creature, RollModifier } from './types';

// Concentration (2024 rules): a creature concentrates on one spell at a time. It ends when the
// creature starts another concentration spell, is Incapacitated or dies, or fails a Constitution save
// after taking damage (DC 10 or half the damage, whichever is higher, at most 30). When it ends, every
// effect of the spell goes with it.

export type ConcentrationEndReason = 'failed-save' | 'incapacitated' | 'down' | 'dead' | 'replaced';

/** The Constitution save DC to keep concentrating after taking `damage`. */
export const concentrationDc = (damage: number): number => Math.min(30, Math.max(10, Math.floor(damage / 2)));

/** Why a concentrating creature must stop right now, if it must (without any save). */
export function mustStop(c: Creature): ConcentrationEndReason | null {
  if (c.status === 'dead') return 'dead';
  if (c.status === 'down' || c.status === 'stable') return 'down';
  return hasCondition(c, 'incapacitated') ? 'incapacitated' : null;
}

export interface Released {
  target: string;
  /** A condition or roll-modifier name. */
  condition: string;
  /** What the creature gets now that the effect is over (Haste's lethargy). */
  ends?: ConditionEffect;
}

/** End a creature's concentration and remove everything it was holding on others. */
export function releaseConcentration(creatures: readonly Creature[], caster: Creature): Released[] {
  const released: Released[] = [];
  delete caster.concentrating;
  for (const c of creatures) {
    for (const cond of [...(c.conditions ?? [])]) {
      if (cond.concentrationOf !== caster.id) continue;
      removeCondition(c, cond);
      released.push({ target: c.name, condition: cond.name });
    }
    for (const m of [...(c.rollMods ?? [])]) {
      if (!m.concentration || m.sourceId !== caster.id) continue;
      c.rollMods = (c.rollMods ?? []).filter((x) => x !== m);
      released.push({ target: c.name, condition: m.name, ...(m.endsWith ? { ends: m.endsWith } : {}) });
    }
  }
  return released;
}

// ----- Roll modifiers (Bane) -----

export function addRollMod(target: Creature, mod: Omit<RollModifier, 'name'>, name: string, sourceId: string, concentration: boolean): ActiveRollMod {
  const active: ActiveRollMod = { ...mod, name, sourceId, roundsLeft: mod.rounds, ...(concentration ? { concentration: true } : {}) };
  // The same effect from the same source is refreshed rather than stacked.
  target.rollMods = [...(target.rollMods ?? []).filter((x) => !(x.name === name && x.sourceId === sourceId)), active];
  return active;
}

const applies = (m: ActiveRollMod, kind: 'attack' | 'save'): boolean => (kind === 'attack' ? m.attacks : m.saves);

/** Roll the dice of every modifier that applies to this kind of roll. The total is signed. */
export function rollModTotal(rng: Rng, c: Creature, kind: 'attack' | 'save'): number {
  let total = 0;
  for (const m of c.rollMods ?? []) if (m.dice && applies(m, kind)) total += m.sign * rollDice(rng, m.dice).total;
  return total;
}

/** The average of rollModTotal, for judging odds without rolling. */
export function rollModAverage(c: Creature, kind: 'attack' | 'save'): number {
  let total = 0;
  for (const m of c.rollMods ?? []) if (m.dice && applies(m, kind)) total += m.sign * averageDice(m.dice);
  return total;
}

/** Start of a round: count down roll modifiers. Returns those that ran out. */
export function tickRollMods(creatures: readonly Creature[]): Released[] {
  const ended: Released[] = [];
  for (const c of creatures) {
    for (const m of [...(c.rollMods ?? [])]) {
      m.roundsLeft -= 1;
      if (m.roundsLeft <= 0) {
        c.rollMods = (c.rollMods ?? []).filter((x) => x !== m);
        ended.push({ target: c.name, condition: m.name, ...(m.endsWith ? { ends: m.endsWith } : {}) });
      }
    }
  }
  return ended;
}