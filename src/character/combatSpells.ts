import { averageDice } from '../engine/dice';
import { abilityMod } from '../engine/types';
import { slugify } from '../data/parseSrdMarkdown';
import type { SpellDef } from '../data/spellTypes';
import type { Character, CharacterSpell } from './characterTypes';

/**
 * Find a sheet's spell in the SRD library by name. The 2024 SRD dropped the proper names from
 * many spells ("Tasha's Hideous Laughter" is "Hideous Laughter", "Melf's Acid Arrow" is "Acid Arrow"),
 * so a possessive prefix is tried without.
 */
export function findSpell(library: readonly SpellDef[], name: string): SpellDef | undefined {
  const byId = new Map(library.map((s) => [s.id, s]));
  const plain = name.replace(/\s*\[R\]\s*$/i, '').trim();
  const direct = byId.get(slugify(plain));
  if (direct) return direct;
  const noPossessive = plain.replace(/^[A-Z][\w-]*(?:['’]s)\s+/, '');
  return noPossessive !== plain ? byId.get(slugify(noPossessive)) : undefined;
}

/** Rough strength of a spell for ranking (not used to choose actions in a fight). */
function spellValue(def: SpellDef, modifier: number): number {
  const e = def.effect;
  if (!e) return 0;
  if (e.kind === 'heal') return averageDice(e.dice) + (e.addsModifier ? modifier : 0);
  const dmg = e.damage.reduce((sum, d) => sum + Math.max(0, averageDice(d.dice)), 0);
  if (dmg === 0) return 0; // conditions only: never chosen by the action rules
  if (e.kind === 'attack') return dmg * (e.count ?? 1) * (e.autoHit ? 1 : 0.65);
  return dmg * (e.halfOnSave ? 0.75 : 0.55) * (e.area ? 1.6 : 1);
}

const MOST_CANTRIPS = 2;
const MOST_DAMAGE_SPELLS = 4;
const MOST_HEALS = 2;

/**
 * Pick the spells a character uses in the simulated fight: its two best damage cantrips, its four
 * best damage spells and two best heals of levels it has slots for, plus any always-prepared spell
 * that has a simulated effect. The review screen lets the user change this.
 */
export function selectCombatSpells(character: Character, library: readonly SpellDef[]): Character {
  const topSlot = Math.max(0, ...Object.entries(character.slots).filter(([, n]) => n > 0).map(([l]) => +l));
  const ability = character.spellcasting[0]?.ability;
  const mod = ability ? abilityMod(character.abilityScores[ability]) : 0;

  interface Candidate {
    spell: CharacterSpell;
    def: SpellDef;
    value: number;
  }
  // A sheet can list one spell under two names (2014 "Melf's Acid Arrow", 2024 "Acid Arrow"):
  // keep one entry per library spell, preferring the 2024 one.
  const byDef = new Map<string, Candidate>();
  for (const spell of character.spells) {
    const def = findSpell(library, spell.name);
    if (!def?.effect || def.level > topSlot) continue;
    const value = spellValue(def, mod);
    if (value <= 0) continue;
    const cur = byDef.get(def.id);
    if (!cur || (/2024/.test(spell.page) && !/2024/.test(cur.spell.page))) byDef.set(def.id, { spell, def, value });
  }
  const candidates = [...byDef.values()];
  const ranked = (list: Candidate[]): Candidate[] => [...list].sort((a, b) => b.value - a.value);

  const chosen = new Set<CharacterSpell>();
  for (const c of ranked(candidates.filter((x) => x.def.level === 0)).slice(0, MOST_CANTRIPS)) chosen.add(c.spell);
  const leveled = candidates.filter((x) => x.def.level > 0);
  for (const c of ranked(leveled.filter((x) => x.def.effect?.kind !== 'heal')).slice(0, MOST_DAMAGE_SPELLS)) chosen.add(c.spell);
  for (const c of ranked(leveled.filter((x) => x.def.effect?.kind === 'heal')).slice(0, MOST_HEALS)) chosen.add(c.spell);
  for (const c of candidates) if (c.spell.alwaysPrepared) chosen.add(c.spell);

  // Spells that list a save or an attack bonus (so they probably do damage) but are not in the SRD
  // library cannot be simulated. Say so instead of leaving them out silently.
  const missing = character.spells.filter((s) => (s.save || s.attackBonus !== undefined) && !findSpell(library, s.name));
  const warnings = character.warnings.filter((w) => !w.startsWith(NOT_IN_LIBRARY));
  if (missing.length > 0) warnings.push(`${NOT_IN_LIBRARY} ${missing.map((s) => s.name).join(', ')}`);

  return { ...character, warnings, spells: character.spells.map((s) => ({ ...s, inCombat: chosen.has(s) })) };
}

const NOT_IN_LIBRARY = 'Not in the SRD spell library, so not simulated:';
