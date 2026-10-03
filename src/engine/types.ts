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

export type Team = 'party' | 'enemies';

/** Target choice profile (action choice is shared by everyone). */
export type TargetProfile = 'weakest' | 'threat' | 'random';

interface ActionBase {
  name: string;
  /** Variants of one spell at different slot levels share this key. Defaults to `name`. */
  spell?: string;
  /** Spell slot level spent; 0 or undefined means free (cantrip, weapon, monster action). */
  slotLevel?: number;
}

export interface AttackAction extends ActionBase {
  kind: 'attack';
  attack: AttackOption;
  /** Attacks made per action (Multiattack / Extra Attack). Default 1. */
  count?: number;
  /** Mixed Multiattack (e.g. 2 Claw + 1 Bite): attacks made in order. Overrides `attack` and `count`. */
  sequence?: AttackOption[];
}

/** The attacks an attack action makes, in order. */
export function attackSequence(a: AttackAction): AttackOption[] {
  return a.sequence ?? Array.from({ length: a.count ?? 1 }, () => a.attack);
}

export interface SaveAction extends ActionBase {
  kind: 'save';
  save: SaveOption;
  /** Hits several enemies (no grid: up to the fight's area-target setting). */
  area?: boolean;
  /** Self-limiting spells (like Burning Hands) hit at most this many. */
  maxTargets?: number;
}

export type Action = AttackAction | SaveAction;

export interface HealAction extends ActionBase {
  dice: string;
}

export interface Combatant {
  creature: Creature;
  team: Team;
  profile: TargetProfile;
  actions: Action[];
  heals: HealAction[];
  /** Remaining spell slots by level. */
  slots: Record<number, number>;
  /** Extra initiative modifier on top of the Dexterity modifier. */
  initiativeBonus?: number;
  /** Combatants sharing a key roll initiative once when grouping is on (e.g. identical goblins). */
  groupKey?: string;
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
