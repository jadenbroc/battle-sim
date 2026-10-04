import { spellToActions, type CasterContext } from '../data/spells';
import type { SpellDef } from '../data/spellTypes';
import { abilityMod, type Action, type AttackAction, type BuffAction, type Combatant, type HealAction } from '../engine/types';
import { totalLevel, type Character, type CharacterSpell, type SpellcastingClass } from './characterTypes';
import { findSpell } from './combatSpells';

export interface ConvertedCharacter {
  combatant: Combatant;
  /** Selected spells that are not in the SRD library (the sheet may list other books). */
  unknownSpells: string[];
  warnings: string[];
}

/** The class a spell belongs to: the one named in its source ("Magic Initiate (Wizard)"), else the first. */
function castingClassFor(spell: CharacterSpell, classes: readonly SpellcastingClass[]): SpellcastingClass | undefined {
  return classes.find((k) => spell.source.toLowerCase().includes(k.name.toLowerCase())) ?? classes[0];
}

/**
 * Turn a character into a combatant: weapon attacks (repeated for Extra Attack), the spells
 * selected for combat with this caster's save DCs and attack bonuses, spell slots, and defenses.
 */
export function characterToCombatant(c: Character, library: readonly SpellDef[]): ConvertedCharacter {
  const warnings: string[] = [];
  const unknownSpells: string[] = [];
  const level = totalLevel(c);
  const actions: Action[] = [];
  const heals: HealAction[] = [];
  const buffs: BuffAction[] = [];

  // The attacks table: weapons use Extra Attack; a row that is an SRD spell is handled as a spell.
  for (const a of c.attacks) {
    if (findSpell(library, a.name)) continue;
    if (!Number.isFinite(a.toHit)) {
      warnings.push(`${a.name}: no attack bonus on the sheet, left out`);
      continue;
    }
    const attack = { name: a.name, toHit: a.toHit, damage: a.damage, range: a.range };
    const action: AttackAction = { kind: 'attack', name: a.name, attack, ...(a.weapon && c.attacksPerAction > 1 ? { count: c.attacksPerAction } : {}) };
    actions.push(action);
  }

  const slotLevels = Object.entries(c.slots).filter(([l, n]) => +l > 0 && n > 0).map(([l]) => +l).sort((x, y) => x - y);
  const used = new Set<string>(); // one sheet spell can appear under two names
  for (const spell of c.spells.filter((s) => s.inCombat)) {
    const def = findSpell(library, spell.name);
    if (!def) {
      unknownSpells.push(spell.name);
      continue;
    }
    if (used.has(def.id)) continue;
    used.add(def.id);
    const cls = castingClassFor(spell, c.spellcasting);
    const ctx: CasterContext = {
      characterLevel: level,
      spellAttackBonus: spell.attackBonus ?? cls?.attackBonus ?? c.proficiencyBonus,
      spellSaveDC: spell.save?.dc ?? cls?.saveDC ?? 8 + c.proficiencyBonus,
      spellModifier: cls ? abilityMod(c.abilityScores[cls.ability]) : 0,
      slotLevels,
    };
    const converted = spellToActions(def, ctx);
    actions.push(...converted.actions);
    heals.push(...converted.heals);
    buffs.push(...converted.buffs);
    warnings.push(...converted.warnings);
  }
  if (unknownSpells.length) warnings.push(`Not in the SRD library, so not simulated: ${unknownSpells.join(', ')}`);

  const combatant: Combatant = {
    creature: {
      id: c.id,
      name: c.name,
      kind: 'character',
      abilityScores: { ...c.abilityScores },
      saveBonuses: { ...c.saveBonuses },
      ac: c.ac,
      maxHp: c.maxHp,
      hp: c.maxHp,
      status: 'alive',
      deathSaves: { successes: 0, failures: 0 },
      resistances: [...c.resistances],
      vulnerabilities: [...c.vulnerabilities],
      immunities: [...c.immunities],
      size: c.size,
      conditionImmunities: [...c.conditionImmunities],
    },
    team: 'party',
    profile: c.profile,
    actions,
    heals,
    ...(buffs.length ? { buffs } : {}),
    slots: Object.fromEntries(Object.entries(c.slots).filter(([l, n]) => +l > 0 && n > 0)),
    initiativeBonus: c.initiativeBonus,
  };
  return { combatant, unknownSpells, warnings };
}
