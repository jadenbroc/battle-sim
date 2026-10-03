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

/**
 * How often an action can be used in a fight (there are no rests inside one fight):
 * - recharge: available at the start; once used, rolls a d6 at the start of each of the
 *   creature's turns and becomes available again on `min` or higher ("Recharge 5-6" -> min 5).
 * - perDay: `uses` times per fight ("3/Day"; "Recharges after a Short or Long Rest" is 1).
 */
export type UseLimit = { kind: 'recharge'; min: number } | { kind: 'perDay'; uses: number };

interface ActionBase {
  name: string;
  /** Variants of one spell at different slot levels share this key. Defaults to `name`. */
  spell?: string;
  /** Spell slot level spent; 0 or undefined means free (cantrip, weapon, monster action). */
  slotLevel?: number;
  /** Usage limit; absent means unlimited. Tracked per combatant by action name. */
  limit?: UseLimit;
  /** Takes the bonus action instead of the action. A creature gets one of each per turn. */
  bonus?: boolean;
}

export interface AttackAction extends ActionBase {
  kind: 'attack';
  attack: AttackOption;
  /** Attacks made per action (Multiattack / Extra Attack). Default 1. */
  count?: number;
  /** Mixed Multiattack (e.g. 2 Claw + 1 Bite): attacks made in order. Overrides `attack` and `count`. */
  sequence?: AttackOption[];
}

/** Uses an action starts a fight with. */
export function initialUses(limit: UseLimit): number {
  return limit.kind === 'recharge' ? 1 : limit.uses;
}

/** True if the action has uses left (unlimited actions always do). */
export function hasUses(c: Pick<Combatant, 'usesLeft'>, action: { name: string; limit?: UseLimit }): boolean {
  if (!action.limit) return true;
  return (c.usesLeft?.[action.name] ?? initialUses(action.limit)) > 0;
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
  /**
   * Uses left of limited actions, keyed by action name (recharge abilities: 1 or 0). A missing key
   * means the action has all of its uses.
   */
  usesLeft?: Record<string, number>;
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
