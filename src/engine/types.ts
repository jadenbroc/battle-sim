export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export function isDamageType(value: string): value is DamageType {
  return (DAMAGE_TYPES as readonly string[]).includes(value.toLowerCase());
}

/** One typed chunk of damage, e.g. { dice: '1d8+3', type: 'slashing' }. */
export interface DamageComponent {
  dice: string;
  type: DamageType;
}

export interface Defenses {
  resistances: readonly DamageType[];
  vulnerabilities: readonly DamageType[];
  immunities: readonly DamageType[];
}

export interface AttackOption {
  name: string;
  /** Total attack bonus (ability mod + proficiency + extras). */
  toHit: number;
  damage: DamageComponent[];
}

export interface SaveOption {
  name: string;
  ability: Ability;
  dc: number;
  damage: DamageComponent[];
  /** True when a successful save halves the damage; false when it negates it. */
  halfOnSave: boolean;
}

/** alive = conscious; down = 0 HP and rolling death saves; stable = 0 HP, not rolling; dead. */
export type LifeStatus = 'alive' | 'down' | 'stable' | 'dead';

export interface DeathSaves {
  successes: number;
  failures: number;
}

export interface Creature extends Defenses {
  id: string;
  name: string;
  /** Characters fall unconscious at 0 HP; monsters die. */
  kind: 'character' | 'monster';
  abilityScores: Record<Ability, number>;
  /** Total saving throw modifiers where they differ from the plain ability modifier. */
  saveBonuses: Partial<Record<Ability, number>>;
  ac: number;
  maxHp: number;
  hp: number;
  status: LifeStatus;
  deathSaves: DeathSaves;
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function saveModifier(c: Creature, ability: Ability): number {
  return c.saveBonuses[ability] ?? abilityMod(c.abilityScores[ability]);
}

/** Conscious creatures that can still act. */
export function isConscious(c: Creature): boolean {
  return c.status === 'alive';
}
