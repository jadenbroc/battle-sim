import type { Ability, ConditionEffect, DamageComponent } from '../engine/types';

/**
 * How a spell grows. Everything is optional; a spell without scaling simply does not grow.
 * - `upcast`: per spell slot level above `above` (the spell's own level for most spells).
 * - `cantrip`: at character levels 5, 11 and 17 (cantrips only).
 */
export interface SpellScaling {
  upcast?: {
    above: number;
    /** Dice added to the first damage component per level above, e.g. "1d6". */
    damageDice?: string;
    /** Extra darts, rays or bolts per level above. */
    count?: number;
    /** Dice added to a healing spell per level above. */
    healDice?: string;
  };
  cantrip?: {
    /** One die of this size is added at each of levels 5, 11 and 17 ("1d10"). */
    damageDice?: string;
    /** Number of beams at level 1, 5, 11 and 17 (Eldritch Blast: [1, 2, 3, 4]). */
    counts?: number[];
  };
}

/** The shape of an area of effect ("15-foot Cone"). */
export interface SpellArea {
  shape: 'cone' | 'cube' | 'sphere' | 'line' | 'cylinder' | 'emanation';
  /** Feet: the size of the cone, cube or line, or the radius of a sphere, cylinder or emanation. */
  size: number;
}

/** A spell that needs an attack roll (or never misses, like Magic Missile). */
export interface AttackSpellEffect {
  kind: 'attack';
  range: 'melee' | 'ranged';
  damage: DamageComponent[];
  /** Darts, rays or beams, each with its own attack roll. Default 1. */
  count?: number;
  /** The attacks always hit (Magic Missile). */
  autoHit?: boolean;
  effects?: ConditionEffect[];
  scaling?: SpellScaling;
}

/** A spell that makes the target(s) save. */
export interface SaveSpellEffect {
  kind: 'save';
  ability: Ability;
  damage: DamageComponent[];
  halfOnSave: boolean;
  /** Set when the spell hits every creature in an area rather than a single target. */
  area?: SpellArea;
  effects?: ConditionEffect[];
  scaling?: SpellScaling;
}

/** A spell that restores Hit Points. */
export interface HealSpellEffect {
  kind: 'heal';
  /** Dice or a flat number ("2d8", "70"). */
  dice: string;
  /** "plus your spellcasting ability modifier". */
  addsModifier: boolean;
  scaling?: SpellScaling;
}

export type SpellEffect = AttackSpellEffect | SaveSpellEffect | HealSpellEffect;

/** A spell in the library format. Save DCs and attack bonuses come from the caster, not the spell. */
export interface SpellDef {
  id: string;
  name: string;
  /** 0 for cantrips. */
  level: number;
  school: string;
  classes: string[];
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  /** The spell's description as plain text, without the scaling paragraphs. */
  text: string;
  /** "Using a Higher-Level Spell Slot" paragraph. */
  higher?: string;
  /** "Cantrip Upgrade" paragraph. */
  cantripUpgrade?: string;
  /** What the engine simulates. Absent for utility, summoning, zone and reaction spells. */
  effect?: SpellEffect;
  /** Why a spell has no effect, or which parts of it are not simulated. */
  notes: string[];
}
