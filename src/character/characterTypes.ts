import type { Ability, ConditionName, DamageComponent, DamageType, Size, TargetProfile } from '../engine/types';

/** How much to trust a value the parser read from a sheet. */
export type Confidence = 'high' | 'low' | 'missing';

export interface CharacterClass {
  name: string;
  level: number;
}

/** A row of the sheet's attacks table that the simulator can use. */
export interface CharacterAttack {
  name: string;
  toHit: number;
  damage: DamageComponent[];
  /** The sheet's notes column (weapon properties and mastery). Shown, not simulated. */
  notes: string;
  range: 'melee' | 'ranged';
  /** Whether Extra Attack applies (weapon attacks, not cantrips or spells). */
  weapon: boolean;
}

/** A spell as listed on the sheet's spell pages. */
export interface CharacterSpell {
  name: string;
  /** "Cleric", "Magic Initiate (Wizard)", ... */
  source: string;
  /** The level from the sheet's section headers (the SRD level wins when the spell is in the library). */
  level: number;
  alwaysPrepared: boolean;
  ritual: boolean;
  /** "1A", "1BA", "1R", "1h + 10m", ... */
  castingTime: string;
  /** This spell's own save DC or attack bonus, as the sheet lists it ("WIS 14" or "+6"). */
  save?: { ability: Ability; dc: number };
  attackBonus?: number;
  /** The sheet's page reference ("PHB-2024 288"); used to prefer the 2024 version of a duplicate. */
  page: string;
  /** Use this spell in the simulated fight. */
  inCombat: boolean;
}

export interface SpellcastingClass {
  name: string;
  ability: Ability;
  saveDC: number;
  attackBonus: number;
}

/** A player character in the simulator: what the importer reads from a sheet, and what a user can edit. */
export interface Character {
  id: string;
  name: string;
  species: string;
  background: string;
  classes: CharacterClass[];
  abilityScores: Record<Ability, number>;
  /** Saving throw totals that differ from the plain ability modifier (proficient saves). */
  saveBonuses: Partial<Record<Ability, number>>;
  proficiencyBonus: number;
  ac: number;
  maxHp: number;
  hitDice: string;
  /** Initiative modifier beyond the Dexterity modifier. */
  initiativeBonus: number;
  speed: string;
  size: Size;
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  conditionImmunities: ConditionName[];
  attacks: CharacterAttack[];
  /** Attacks per Attack action (Extra Attack): 1, 2, 3 or 4. */
  attacksPerAction: number;
  spellcasting: SpellcastingClass[];
  spells: CharacterSpell[];
  /** Spell slots by level. */
  slots: Record<number, number>;
  profile: TargetProfile;
  /** Features and traits as text, for the review screen. */
  features: string;
  /** Per-field confidence from the importer. Fields the user has edited are marked 'high'. */
  confidence: Record<string, Confidence>;
  /** Things the importer noticed: unreadable fields, guesses, spells it cannot use. */
  warnings: string[];
}

export function totalLevel(c: Pick<Character, 'classes'>): number {
  return c.classes.reduce((sum, k) => sum + k.level, 0);
}
