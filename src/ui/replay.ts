import type { FightConfig, LogEvent, LoggedEvent } from '../engine/fight';
import type { DamageOutcome } from '../engine/hp';
import type { LifeStatus, Team } from '../engine/types';

export interface FighterView {
  name: string;
  team: Team;
  hp: number;
  maxHp: number;
  status: LifeStatus;
}

export interface FormattedEvent {
  kind: LogEvent['kind'];
  text: string;
}

/** Each fighter's HP and status after the first `count` log events (0 = start of fight). */
export function viewAt(config: FightConfig, log: readonly LoggedEvent[], count: number): FighterView[] {
  const views = new Map<string, FighterView>(
    config.combatants.map((c) => [
      c.creature.name,
      { name: c.creature.name, team: c.team, hp: c.creature.hp, maxHp: c.creature.maxHp, status: c.creature.status },
    ]),
  );

  for (const { event } of log.slice(0, count)) {
    if (event.kind === 'attack' || event.kind === 'save') {
      const v = views.get(event.target);
      if (v && event.outcome) {
        v.hp = event.outcome.hpAfter;
        v.status = event.outcome.statusAfter;
      }
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
    }
  }
  return [...views.values()];
}

function dropNote(target: string, o: DamageOutcome | null): string {
  if (!o || o.statusBefore === o.statusAfter) return '';
  if (o.statusAfter === 'dead') return o.instantDeath && o.statusBefore !== 'alive' ? ` ${target} is killed outright!` : ` ${target} dies.`;
  if (o.statusAfter === 'down') return ` ${target} drops to 0 HP and falls unconscious.`;
  return '';
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
      const roll = `${r.roll.total}${r.roll.rolls.length > 1 ? ` (${r.roll.rolls.join('/')})` : ''}`;
      const head = `${event.attacker} attacks ${event.target} with ${event.option}: ${roll}`;
      if (!r.hit) return { kind, text: `${head}, miss.` };
      const dmg = event.damage.length ? damageText(event.damage) : '0';
      return { kind, text: `${head}, ${r.crit ? 'CRITICAL HIT' : 'hit'} for ${dmg}.${dropNote(event.target, event.outcome)}` };
    }
    case 'save': {
      const s = event.saveRoll;
      const head = `${event.caster} uses ${event.option} on ${event.target}: save ${s.roll.total}, ${s.success ? 'success' : 'fail'}`;
      const dmg = event.damage.length ? `takes ${damageText(event.damage)}` : 'takes no damage';
      return { kind, text: `${head}, ${dmg}.${dropNote(event.target, event.outcome)}` };
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
