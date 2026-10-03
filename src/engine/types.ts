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

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
/** The 14 ordinary conditions. Exhaustion is a level on the creature (`exhaustion`). */
export type ConditionName = (typeof CONDITIONS)[number];

export function isConditionName(value: string): value is ConditionName {
  return (CONDITIONS as readonly string[]).includes(value.toLowerCase());
}

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type Size = (typeof SIZES)[number];

/**
 * How long a condition lasts, as written on the effect:
 * - indefinite: until something removes it (escape, the source going down, ...)
 * - endOfTargetNextTurn: "until the end of its next turn"
 * - startOfSourceNextTurn / endOfSourceNextTurn: "until the start/end of the <attacker>'s next turn"
 * - rounds: a fixed number of rounds (1 minute = 10 rounds)
 * - while: lasts while the target keeps another condition from the same source ("until the grapple
 *   ends" = while Grappled; "While Poisoned, the target has the Paralyzed condition")
 */
export type Duration =
  | { kind: 'indefinite' }
  | { kind: 'endOfTargetNextTurn' }
  | { kind: 'startOfSourceNextTurn' }
  | { kind: 'endOfSourceNextTurn' }
  | { kind: 'rounds'; n: number }
  | { kind: 'while'; condition: ConditionName };

/** A condition an attack or save effect inflicts. */
export interface ConditionEffect {
  condition: ConditionName;
  duration: Duration;
  /** Only creatures of this size or smaller are affected ("a Large or smaller creature"). */
  maxSize?: Size;
  /** Attack riders: the target may roll this save to avoid the condition. */
  avoidSave?: { ability: Ability; dc: number };
  /** The target repeats this save at the end of each of its turns, ending the condition on success. */
  repeatSave?: { ability: Ability; dc: number };
  /** Grappled: the DC to escape. */
  escapeDc?: number;
}

/** A condition currently on a creature. */
export interface ActiveCondition {
  name: ConditionName;
  /** The creature that inflicted it (for Charmed, Frightened, Grappled). */
  sourceId?: string;
  duration: Duration;
  /** Turn-boundary expiry: when `at` happens for creature `id`, after skipping `skip` such events. */
  expires?: { id: string; at: 'start' | 'end'; skip: number };
  /** Rounds left, for `rounds` durations. */
  roundsLeft?: number;
  repeatSave?: { ability: Ability; dc: number };
  escapeDc?: number;
}

export interface AttackOption {
  name: string;
  /** Total attack bonus (ability mod + proficiency + extras). */
  toHit: number;
  damage: DamageComponent[];
  /** Melee attacks count as within 5 feet of the target, ranged ones do not. Default melee. */
  range?: 'melee' | 'ranged';
  /** Conditions inflicted on a hit. */
  effects?: ConditionEffect[];
}

export interface SaveOption {
  name: string;
  ability: Ability;
  dc: number;
  damage: DamageComponent[];
  /** True when a successful save halves the damage; false when it negates it. */
  halfOnSave: boolean;
  /** Conditions inflicted on a failed save. */
  effects?: ConditionEffect[];
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
  /** Default medium. Size-limited effects ("a Large or smaller creature") check this. */
  size?: Size;
  /** Conditions currently affecting the creature. */
  conditions?: ActiveCondition[];
  /** Exhaustion level (0-6). Each level is -2 on D20 Tests; level 6 is death. */
  exhaustion?: number;
  /** Conditions the creature cannot gain. */
  conditionImmunities?: ConditionName[];
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
  /** Only usable on a target that has this condition ("one creature that has the Prone condition"). */
  targetRequires?: ConditionName;
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
