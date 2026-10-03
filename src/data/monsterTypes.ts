import type { Ability, AttackAction, DamageType, SaveAction } from '../engine/types';

/** A named trait or action kept as text for display (the engine does not simulate it yet). */
export interface MonsterFeature {
  name: string;
  text: string;
}

/**
 * An action the engine can simulate (a weapon attack or a damage-dealing save effect). It may
 * carry a usage `limit` (recharge or N per day) and a `bonus` flag for the bonus action slot.
 */
export type MonsterAction = AttackAction | SaveAction;

/**
 * One entry of a Multiattack, e.g. "two Claw attacks" -> { action: 'Claw', count: 2 }.
 * "Two attacks, using Mace or Radiant Flame in any combination" sets `options`; the simulator
 * uses whichever option has the highest average damage.
 */
export interface MultiattackPart {
  action: string;
  count: number;
  options?: string[];
}

/** A monster in the library format (also the documented format for custom/imported monsters). */
export interface MonsterDef {
  id: string;
  name: string;
  size: string;
  type: string;
  subtype?: string;
  alignment: string;
  /** Challenge rating as printed: "0", "1/8", "1/4", "1/2", "1", ... */
  cr: string;
  crValue: number;
  xp: number;
  proficiencyBonus: number;
  ac: number;
  hp: number;
  hitDice: string;
  abilityScores: Record<Ability, number>;
  /** Saving throw totals that differ from the plain ability modifier (proficient saves). */
  saveBonuses: Partial<Record<Ability, number>>;
  /** Initiative modifier beyond the Dexterity modifier. */
  initiativeBonus: number;
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  conditionImmunities: string[];
  actions: MonsterAction[];
  multiattack?: { text: string; parts: MultiattackPart[] };
  traits: MonsterFeature[];
  bonusActions: MonsterFeature[];
  reactions: MonsterFeature[];
  legendaryActions: MonsterFeature[];
  /** Actions that could not be turned into simulated attacks (Spellcasting, grapples, ...). */
  otherActions: MonsterFeature[];
  /** Data-quality notes, e.g. resistances that depend on nonmagical weapons. */
  notes: string[];
  /** Set on monsters from the user's own private data (never part of the bundled SRD library). */
  private?: true;
}
