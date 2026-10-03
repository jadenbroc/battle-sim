import { averageDice } from '../engine/dice';
import type { Action, AttackAction, AttackOption, Combatant } from '../engine/types';
import type { MonsterAction, MonsterDef } from './monsterTypes';

/** Enemy groups are capped for Milestone 1. */
export const MAX_GROUP_SIZE = 12;

/** Loads the bundled SRD 5.2 monster library (split into its own chunk). */
export async function loadSrdMonsters(): Promise<MonsterDef[]> {
  const mod = await import('./srd-monsters.json');
  return mod.default as unknown as MonsterDef[];
}

// ----- Search and filter -----

export interface MonsterFilter {
  query?: string;
  minCr?: number;
  maxCr?: number;
  type?: string;
}

export function searchMonsters(monsters: readonly MonsterDef[], f: MonsterFilter = {}): MonsterDef[] {
  const q = f.query?.trim().toLowerCase();
  return monsters.filter(
    (m) =>
      (!q || m.name.toLowerCase().includes(q)) &&
      (f.minCr === undefined || m.crValue >= f.minCr) &&
      (f.maxCr === undefined || m.crValue <= f.maxCr) &&
      (!f.type || m.type === f.type),
  );
}

export function monsterTypes(monsters: readonly MonsterDef[]): string[] {
  return [...new Set(monsters.map((m) => m.type))].sort();
}

// ----- Enemy groups -----

export interface GroupEntry {
  id: string;
  count: number;
}

export function groupSize(group: readonly GroupEntry[]): number {
  return group.reduce((sum, e) => sum + e.count, 0);
}

/** Adds `delta` (may be negative) of a monster, respecting the group cap. Returns a new group. */
export function adjustGroup(group: readonly GroupEntry[], id: string, delta: number): GroupEntry[] {
  const current = group.find((e) => e.id === id)?.count ?? 0;
  const room = MAX_GROUP_SIZE - (groupSize(group) - current);
  const next = Math.max(0, Math.min(current + delta, room));
  const rest = group.filter((e) => e.id !== id);
  if (next === 0) return rest;
  return group.some((e) => e.id === id) ? group.map((e) => (e.id === id ? { id, count: next } : e)) : [...rest, { id, count: next }];
}

// ----- Monster -> engine combatants -----

/** Plain actions (no usage limit, not a bonus action) are what a Multiattack can draw on. */
const isPlain = (a: MonsterAction): boolean => !a.limit && !a.bonus;

/**
 * Actions the engine can use, including recharge and per-day abilities and bonus actions (the
 * engine tracks their uses). Multiattack becomes one action that runs its attacks in order.
 */
export function engineActions(def: MonsterDef): Action[] {
  const actions: Action[] = structuredClone(def.actions);
  const { sequence } = resolveMultiattack(def);
  if (sequence.length > 1) {
    const multi: AttackAction = { kind: 'attack', name: 'Multiattack', attack: sequence[0]!, sequence };
    actions.push(multi);
  }
  return actions;
}

const avgDamage = (a: AttackOption): number => a.damage.reduce((sum, d) => sum + averageDice(d.dice), 0);

/**
 * The attacks a Multiattack makes, in order. "Any combination" parts use the option with the
 * highest average damage. `complete` is false when some part names an action we can't simulate.
 */
export function resolveMultiattack(def: MonsterDef): { sequence: AttackOption[]; complete: boolean } {
  const attacks = new Map<string, AttackOption>();
  for (const a of def.actions) if (isPlain(a) && a.kind === 'attack') attacks.set(a.name.toLowerCase(), a.attack);

  const parts = def.multiattack?.parts ?? [];
  const sequence: AttackOption[] = [];
  let complete = parts.length > 0;
  for (const p of parts) {
    const found = (p.options ?? [p.action]).flatMap((n) => attacks.get(n.toLowerCase()) ?? []);
    if (found.length === 0) {
      complete = false;
      continue;
    }
    const best = found.reduce((a, b) => (avgDamage(b) > avgDamage(a) ? b : a));
    for (let i = 0; i < p.count; i++) sequence.push(best);
  }
  return { sequence, complete };
}

/** What the engine will not simulate for this monster, for a visible warning in the UI. */
export function notSimulated(def: MonsterDef): string[] {
  const out: string[] = [];
  if (def.otherActions.length) out.push(`Other actions: ${def.otherActions.map((a) => a.name).join(', ')}`);
  if (def.bonusActions.length) out.push(`Bonus actions: ${def.bonusActions.map((a) => a.name).join(', ')}`);
  if (def.reactions.length) out.push(`Reactions: ${def.reactions.map((a) => a.name).join(', ')}`);
  if (def.legendaryActions.length) out.push('Legendary actions');
  if (def.traits.length) out.push(`Traits: ${def.traits.map((a) => a.name).join(', ')}`);
  for (const n of def.notes) out.push(n);

  if (def.multiattack && !resolveMultiattack(def).complete) out.push('Multiattack only partly simulated');
  if (!engineActions(def).length) out.push('No simulated attacks: this monster will do nothing on its turn');
  return out;
}

/**
 * Build `count` combatants from a monster. Names get a number when there is more than one
 * (Goblin Warrior 1, 2, ...). Identical monsters share a groupKey for grouped initiative.
 */
export function monsterToCombatants(def: MonsterDef, count: number, startNumber = 1): Combatant[] {
  const actions = engineActions(def);
  return Array.from({ length: count }, (_, i) => {
    const n = startNumber + i;
    const numbered = count > 1 || startNumber > 1;
    return {
      creature: {
        id: `${def.id}-${n}`,
        name: numbered ? `${def.name} ${n}` : def.name,
        kind: 'monster',
        abilityScores: { ...def.abilityScores },
        saveBonuses: { ...def.saveBonuses },
        ac: def.ac,
        maxHp: def.hp,
        hp: def.hp,
        status: 'alive',
        deathSaves: { successes: 0, failures: 0 },
        resistances: [...def.resistances],
        vulnerabilities: [...def.vulnerabilities],
        immunities: [...def.immunities],
      },
      team: 'enemies',
      profile: 'random',
      actions: structuredClone(actions),
      heals: [],
      slots: {},
      initiativeBonus: def.initiativeBonus,
      groupKey: def.id,
    } satisfies Combatant;
  });
}

/** Combatants for a whole enemy group. Unknown monster ids are skipped and reported. */
export function buildEnemyGroup(
  library: readonly MonsterDef[],
  group: readonly GroupEntry[],
): { combatants: Combatant[]; unknown: string[] } {
  const byId = new Map(library.map((m) => [m.id, m]));
  const combatants: Combatant[] = [];
  const unknown: string[] = [];
  for (const entry of group) {
    const def = byId.get(entry.id);
    if (def) combatants.push(...monsterToCombatants(def, entry.count));
    else unknown.push(entry.id);
  }
  return { combatants, unknown };
}
