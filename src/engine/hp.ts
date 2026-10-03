import { rollD20 } from './dice';
import type { Rng } from './rng';
import type { Creature } from './types';

export interface DamageOutcome {
  /** Damage that reduced HP or counted against a downed creature. */
  amount: number;
  hpBefore: number;
  hpAfter: number;
  statusBefore: Creature['status'];
  statusAfter: Creature['status'];
  /** Death-save failures added by this hit (0 unless the creature was already down). */
  failuresAdded: number;
  /** True when the hit killed outright (monster at 0, or leftover damage >= max HP). */
  instantDeath: boolean;
}

function resetDeathSaves(c: Creature): void {
  c.deathSaves = { successes: 0, failures: 0 };
}

/** Apply already-adjusted damage to a creature, following the 0 HP rules. Mutates `c`. */
export function applyDamage(c: Creature, amount: number, opts: { crit?: boolean } = {}): DamageOutcome {
  const hpBefore = c.hp;
  const statusBefore = c.status;
  const outcome = (instantDeath = false, failuresAdded = 0): DamageOutcome => ({
    amount,
    hpBefore,
    hpAfter: c.hp,
    statusBefore,
    statusAfter: c.status,
    failuresAdded,
    instantDeath,
  });

  if (amount <= 0 || c.status === 'dead') return { ...outcome(), amount: 0 };

  // Already at 0 HP: damage is a death-save failure (two on a crit); big hits kill outright.
  if (c.status === 'down' || c.status === 'stable') {
    if (amount >= c.maxHp) {
      c.status = 'dead';
      return outcome(true);
    }
    const failuresAdded = opts.crit ? 2 : 1;
    c.status = 'down'; // damage ends stability
    c.deathSaves.failures += failuresAdded;
    if (c.deathSaves.failures >= 3) c.status = 'dead';
    return outcome(false, failuresAdded);
  }

  const leftover = amount - c.hp;
  c.hp = Math.max(0, c.hp - amount);
  if (c.hp > 0) return outcome();

  if (c.kind === 'monster' || leftover >= c.maxHp) {
    c.status = 'dead';
    return outcome(true);
  }
  c.status = 'down';
  resetDeathSaves(c);
  return outcome();
}

/** Restore HP. Any healing brings a downed or stable creature back up. Returns HP actually gained. */
export function heal(c: Creature, amount: number): number {
  if (amount <= 0 || c.status === 'dead') return 0;
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + amount);
  if (c.status === 'down' || c.status === 'stable') {
    c.status = 'alive';
    resetDeathSaves(c);
  }
  return c.hp - before;
}

export interface DeathSaveResult {
  natural: number;
  outcome: 'success' | 'failure' | 'revived' | 'stabilized' | 'died';
}

/**
 * Roll a death save for a downed character. Mutates `c`.
 * 10+ succeeds, a 1 counts as two failures, a 20 regains 1 HP.
 * Three successes stabilize; three failures kill.
 */
export function rollDeathSave(rng: Rng, c: Creature): DeathSaveResult {
  if (c.status !== 'down') throw new Error(`${c.name} is not making death saves (status: ${c.status})`);
  const { natural } = rollD20(rng);

  if (natural === 20) {
    c.hp = 1;
    c.status = 'alive';
    resetDeathSaves(c);
    return { natural, outcome: 'revived' };
  }

  if (natural >= 10) {
    c.deathSaves.successes += 1;
    if (c.deathSaves.successes >= 3) {
      c.status = 'stable';
      resetDeathSaves(c);
      return { natural, outcome: 'stabilized' };
    }
    return { natural, outcome: 'success' };
  }

  c.deathSaves.failures += natural === 1 ? 2 : 1;
  if (c.deathSaves.failures >= 3) {
    c.status = 'dead';
    return { natural, outcome: 'died' };
  }
  return { natural, outcome: 'failure' };
}
