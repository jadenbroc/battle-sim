import { runFight, type FightConfig, type Outcome } from './fight';
import { createRng } from './rng';
import type { Team } from './types';

export interface CombatantSummary {
  id: string;
  name: string;
  team: Team;
  /** Average damage dealt per round, over every round of every fight. */
  avgDamagePerRound: number;
  /** Share of fights where the creature was not dead at the end. */
  survivalRate: number;
}

export interface BulkResult {
  runs: number;
  seed: string | number;
  buckets: Record<Outcome, number>;
  /** Party wins (clean or with deaths) as a share of runs. */
  winRate: number;
  avgRounds: number;
  combatants: CombatantSummary[];
}

/** Seed for fight number `index` of a bulk run, so any single fight can be replayed exactly. */
export function fightSeed(seed: string | number, index: number): string {
  return `${seed}:${index}`;
}

export function runBulk(
  config: FightConfig,
  runs: number,
  seed: string | number,
  onProgress?: (done: number, total: number) => void,
): BulkResult {
  const buckets: Record<Outcome, number> = { 'won-clean': 0, 'won-deaths': 0, tpk: 0, stalemate: 0 };
  const totals = new Map<string, { damage: number; survived: number }>();
  for (const c of config.combatants) totals.set(c.creature.id, { damage: 0, survived: 0 });
  let totalRounds = 0;

  for (let i = 0; i < runs; i++) {
    const result = runFight(config, createRng(fightSeed(seed, i)));
    buckets[result.outcome]++;
    totalRounds += result.rounds;
    for (const s of result.stats) {
      const t = totals.get(s.id)!;
      t.damage += s.damageDealt;
      if (s.survived) t.survived++;
    }
    if (onProgress && (i + 1) % 250 === 0) onProgress(i + 1, runs);
  }
  onProgress?.(runs, runs);

  return {
    runs,
    seed,
    buckets,
    winRate: runs ? (buckets['won-clean'] + buckets['won-deaths']) / runs : 0,
    avgRounds: runs ? totalRounds / runs : 0,
    combatants: config.combatants.map((c) => {
      const t = totals.get(c.creature.id)!;
      return {
        id: c.creature.id,
        name: c.creature.name,
        team: c.team,
        avgDamagePerRound: totalRounds ? t.damage / totalRounds : 0,
        survivalRate: runs ? t.survived / runs : 0,
      };
    }),
  };
}
