import type { AppliedCondition } from '../engine/combat';
import type { FightConfig, LogEvent, LoggedEvent } from '../engine/fight';
import type { DamageOutcome } from '../engine/hp';
import type { LifeStatus, Team } from '../engine/types';

export interface FighterView {
  name: string;
  team: Team;
  hp: number;
  maxHp: number;
  status: LifeStatus;
  /** Conditions currently affecting the fighter (without duplicates). */
  conditions: string[];
}

export interface FormattedEvent {
  kind: LogEvent['kind'];
  text: string;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Each fighter's HP, status and conditions after the first `count` log events (0 = start of fight). */
export function viewAt(config: FightConfig, log: readonly LoggedEvent[], count: number): FighterView[] {
  const views = new Map<string, FighterView>(
    config.combatants.map((c) => [
      c.creature.name,
      {
        name: c.creature.name,
        team: c.team,
        hp: c.creature.hp,
        maxHp: c.creature.maxHp,
        status: c.creature.status,
        conditions: (c.creature.conditions ?? []).map((x) => x.name),
      },
    ]),
  );
  const add = (applied: readonly AppliedCondition[]): void => {
    for (const a of applied) views.get(a.target)?.conditions.push(a.condition);
  };
  const remove = (name: string, condition: string): void => {
    const v = views.get(name);
    const i = v ? v.conditions.indexOf(condition) : -1;
    if (v && i >= 0) v.conditions.splice(i, 1);
  };

  for (const { event } of log.slice(0, count)) {
    if (event.kind === 'attack' || event.kind === 'save') {
      const v = views.get(event.target);
      if (v && event.outcome) {
        v.hp = event.outcome.hpAfter;
        v.status = event.outcome.statusAfter;
      }
      add(event.applied);
    } else if (event.kind === 'heal') {
      const v = views.get(event.target);
      if (v && v.status !== 'dead') {
        v.hp = Math.min(v.maxHp, v.hp + event.amount);
        if (v.status === 'down' || v.status === 'stable') v.status = 'alive';
      }
    } else if (event.kind === 'death-save') {
      const v = views.get(event.actor);
      if (!v) continue;
      if (event.outcome === 'revived') {
        v.hp = 1;
        v.status = 'alive';
      } else if (event.outcome === 'stabilized') v.status = 'stable';
      else if (event.outcome === 'died') v.status = 'dead';
    } else if (event.kind === 'condition-end') {
      remove(event.target, event.condition);
    } else if (event.kind === 'repeat-save' && event.success) {
      remove(event.actor, event.condition);
    } else if (event.kind === 'escape' && event.success) {
      remove(event.actor, 'grappled');
    }
  }

  return [...views.values()].map((v) => ({ ...v, conditions: [...new Set(v.conditions)] }));
}

function dropNote(target: string, o: DamageOutcome | null): string {
  if (!o || o.statusBefore === o.statusAfter) return '';
  if (o.statusAfter === 'dead') return o.instantDeath && o.statusBefore !== 'alive' ? ` ${target} is killed outright!` : ` ${target} dies.`;
  if (o.statusAfter === 'down') return ` ${target} drops to 0 HP and falls unconscious.`;
  return '';
}

function appliedNote(applied: readonly AppliedCondition[]): string {
  return applied.map((a) => ` ${a.target} is now ${cap(a.condition)}.`).join('');
}

function damageText(parts: { type: string; final: number; effect: string }[]): string {
  return parts
    .map((p) => `${p.final} ${p.type}${p.effect === 'normal' ? '' : ` (${p.effect})`}`)
    .join(' + ');
}

export function formatEvent(event: LogEvent): FormattedEvent {
  const kind = event.kind;
  switch (event.kind) {
    case 'initiative':
      return { kind, text: `Initiative: ${event.order.map((o) => `${o.name} ${o.total}`).join(', ')}` };
    case 'round-start':
      return { kind, text: `Round ${event.round}` };
    case 'attack': {
      const r = event.attackRoll;
      const dice = r.roll.rolls.length > 1 ? ` (${r.roll.rolls.join('/')}, ${event.mode})` : '';
      if (event.autoHit) {
        const dmg = event.damage.length ? damageText(event.damage) : '0';
        return { kind, text: `${event.attacker}'s ${event.option} strikes ${event.target} automatically for ${dmg}.${dropNote(event.target, event.outcome)}${appliedNote(event.applied)}` };
      }
      const head = `${event.attacker} attacks ${event.target} with ${event.option}: ${r.roll.total}${dice}`;
      if (!r.hit) return { kind, text: `${head}, miss.` };
      const dmg = event.damage.length ? damageText(event.damage) : '0';
      const crit = r.crit ? (r.roll.isNat20 ? 'CRITICAL HIT' : 'CRITICAL HIT (automatic)') : 'hit';
      return { kind, text: `${head}, ${crit} for ${dmg}.${dropNote(event.target, event.outcome)}${appliedNote(event.applied)}` };
    }
    case 'save': {
      const s = event.saveRoll;
      const dice = s.roll.rolls.length > 1 ? ` (${s.roll.rolls.join('/')}, ${event.mode})` : '';
      const head = event.autoFail
        ? `${event.caster} uses ${event.option} on ${event.target}: automatically fails the save`
        : `${event.caster} uses ${event.option} on ${event.target}: save ${s.roll.total}${dice}, ${s.success ? 'success' : 'fail'}`;
      const dmg = event.damage.length ? `takes ${damageText(event.damage)}` : 'takes no damage';
      const tail = event.damage.length === 0 && event.applied.length > 0 ? '.' : `, ${dmg}.`;
      return { kind, text: `${head}${tail}${dropNote(event.target, event.outcome)}${appliedNote(event.applied)}` };
    }
    case 'heal':
      return { kind, text: `${event.actor} casts ${event.option} on ${event.target}, restoring ${event.amount} HP.` };
    case 'death-save': {
      const results: Record<typeof event.outcome, string> = {
        success: 'succeeds',
        failure: 'fails',
        revived: 'rolls a natural 20 and regains 1 HP',
        stabilized: 'succeeds and is stable',
        died: 'fails and dies',
      };
      return { kind, text: `${event.actor} makes a death save (${event.natural}): ${results[event.outcome]}.` };
    }
    case 'recharge':
      return {
        kind,
        text: `${event.actor} rolls to recharge ${event.option}: ${event.roll}, ${event.success ? 'recharged!' : 'still recharging.'}`,
      };
    case 'condition-end': {
      const how = { expired: 'the effect ends', released: 'released', 'stood-up': 'stands up' }[event.reason];
      return { kind, text: `${event.target} is no longer ${cap(event.condition)} (${how}).` };
    }
    case 'repeat-save':
      return {
        kind,
        text: event.autoFail
          ? `${event.actor} automatically fails the save against ${cap(event.condition)}.`
          : `${event.actor} repeats the save against ${cap(event.condition)}: ${event.roll} vs DC ${event.dc}, ${event.success ? 'the condition ends.' : 'it persists.'}`,
      };
    case 'escape':
      return {
        kind,
        text: `${event.actor} tries to escape the grapple: ${event.roll} vs DC ${event.dc}, ${event.success ? 'escaped!' : 'still held.'}`,
      };
    case 'skip':
      return { kind, text: `${event.actor} can't act (${event.reason}).` };
    case 'no-action':
      return { kind, text: `${event.actor} has nothing to do.` };
    case 'end': {
      const labels = {
        'won-clean': 'The party wins, and nobody died.',
        'won-deaths': 'The party wins, but not everyone survived.',
        tpk: 'Total party kill.',
        stalemate: 'Stalemate: the round limit was reached.',
      };
      return { kind, text: `${labels[event.outcome]} (${event.rounds} round${event.rounds === 1 ? '' : 's'})` };
    }
  }
}
