import { slugify } from '../data/parseSrdMarkdown';
import {
  ABILITIES,
  abilityMod,
  isConditionName,
  isDamageType,
  type Ability,
  type ConditionName,
  type DamageComponent,
  type DamageType,
  type Size,
  SIZES,
} from '../engine/types';
import type { Character, CharacterAttack, CharacterClass, CharacterSpell, Confidence, SpellcastingClass } from './characterTypes';
import type { PdfField } from './pdfFields';

// Reads a D&D Beyond character sheet PDF from its form fields. Field names seen in real exports:
//   CharacterName, CLASS  LEVEL ("Cleric 1 / Wizard 3"), RACE, BACKGROUND, STR / STRmod, ST Strength,
//   ProfBonus, AC, MaxHP, Total (hit dice), Init, Speed, Defenses, SIZE, Wpn Name / Wpn1 AtkBonus /
//   Wpn1 Damage / Wpn Notes 1, and on the spell pages spellName0, spellSource0, spellSaveHit0,
//   spellCastingTime0, spellPrepared0, spellPage0, spellHeader0 ("=== 1st LEVEL ==="), spellSlotHeader0
//   ("4 Slots OOOO"), spellCastingClass0 / Ability0 / SaveDC0 / AtkBonus0.

const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** A signed number like "+5", "-1" or "12". Returns undefined for "", "--" and other text. */
export function parseSigned(text: string | undefined): number | undefined {
  const m = /^\s*([+\-−])?\s*(\d+)\s*$/.exec(text ?? '');
  if (!m) return undefined;
  const n = parseInt(m[2]!, 10);
  return m[1] === '-' || m[1] === '−' ? -n : n;
}

/** "1d6+4 Bludgeoning", "5 Bludgeoning", "1d8+3 Slashing + 1d6 Fire" -> damage components. */
export function parseSheetDamage(text: string): DamageComponent[] {
  const out: DamageComponent[] = [];
  const re = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)\s+([A-Za-z]+)/g;
  for (const m of text.replace(/−/g, '-').matchAll(re)) {
    const type = m[2]!.toLowerCase();
    if (!isDamageType(type)) continue;
    out.push({ dice: m[1]!.replace(/\s+/g, ''), type: type as DamageType });
  }
  return out;
}

/** "Cleric 1 / Wizard 3" -> [{Cleric, 1}, {Wizard, 3}]. */
export function parseClasses(text: string): CharacterClass[] {
  return text
    .split('/')
    .map((part) => /^\s*(.+?)\s+(\d+)\s*$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1]!, level: parseInt(m[2]!, 10) }));
}

function parseDefenses(text: string, notes: string[]): Pick<Character, 'resistances' | 'vulnerabilities' | 'immunities' | 'conditionImmunities'> {
  const out = { resistances: new Set<DamageType>(), vulnerabilities: new Set<DamageType>(), immunities: new Set<DamageType>(), conditionImmunities: new Set<ConditionName>() };
  for (const line of text.split(/\n/)) {
    const m = /^\s*(Resistances?|Vulnerabilit(?:y|ies)|Immunit(?:y|ies))\s*[-:–]\s*(.*)$/i.exec(line);
    if (!m) continue;
    const kind = m[1]!.toLowerCase();
    for (const raw of m[2]!.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (isDamageType(raw)) {
        (kind.startsWith('res') ? out.resistances : kind.startsWith('vul') ? out.vulnerabilities : out.immunities).add(raw as DamageType);
      } else if (kind.startsWith('imm') && isConditionName(raw)) out.conditionImmunities.add(raw as ConditionName);
      else notes.push(`${m[1]} not applied (not a damage type): ${raw}`);
    }
  }
  return {
    resistances: [...out.resistances],
    vulnerabilities: [...out.vulnerabilities],
    immunities: [...out.immunities],
    conditionImmunities: [...out.conditionImmunities],
  };
}

const RANGED_NAME = /bow|sling|blowgun|dart|javelin|net\b/i;
const SPELL_NOTES = /^[VSM](?:\/[VSM])*$/;

function parseAttacks(get: (name: string) => string, warnings: string[]): CharacterAttack[] {
  const attacks: CharacterAttack[] = [];
  for (let row = 1; row <= 6; row++) {
    const name = get(row === 1 ? 'Wpn Name' : `Wpn Name ${row}`);
    if (!name) continue;
    const damage = parseSheetDamage(get(`Wpn${row} Damage`));
    const toHit = parseSigned(get(`Wpn${row} AtkBonus`));
    const notes = get(row === 1 ? 'Wpn Notes 1' : `Wpn Notes ${row}`);
    // Rows with no damage (class feature reminders) or only 0 damage (an unarmed strike) are no use in a fight.
    if (damage.length === 0 || damage.every((d) => d.dice === '0')) continue;
    attacks.push({
      name,
      toHit: toHit ?? Number.NaN, // NaN: blank on the sheet; filled in from the spell list when it is a spell
      damage,
      notes,
      range: /Ammunition/i.test(notes) || RANGED_NAME.test(name) ? 'ranged' : 'melee',
      weapon: !SPELL_NOTES.test(notes),
    });
  }
  void warnings;
  return attacks;
}

/** Reading order on the spell pages: page ascending, then top to bottom. */
const readingOrder = (a: { page: number; y: number }, b: { page: number; y: number }): number => a.page - b.page || b.y - a.y;

interface SpellHeader {
  page: number;
  y: number;
  level: number;
  slots?: number;
}

function parseSpellHeaders(fields: PdfField[]): SpellHeader[] {
  const slotByIndex = new Map(fields.flatMap((f) => (/^spellSlotHeader(\d+)$/.test(f.name) ? [[+/(\d+)$/.exec(f.name)![1]!, f.value] as const] : [])));
  const headers: SpellHeader[] = [];
  for (const f of fields) {
    const m = /^spellHeader(\d+)$/.exec(f.name);
    if (!m || !f.value.trim()) continue;
    const text = f.value.toUpperCase();
    const level = /CANTRIP/.test(text) ? 0 : /(\d+)(?:ST|ND|RD|TH)\s+LEVEL/.exec(text) ? +/(\d+)(?:ST|ND|RD|TH)\s+LEVEL/.exec(text)![1]! : undefined;
    if (level === undefined) continue;
    const slots = /(\d+)\s+SLOTS?/i.exec(slotByIndex.get(+m[1]!) ?? '');
    headers.push({ page: f.page, y: f.y, level, ...(slots ? { slots: +slots[1]! } : {}) });
  }
  return headers.sort(readingOrder);
}

function parseSpells(fields: PdfField[], notes: string[]): { spells: CharacterSpell[]; slots: Record<number, number> } {
  const headers = parseSpellHeaders(fields);
  const slots: Record<number, number> = {};
  for (const h of headers) if (h.slots !== undefined && slots[h.level] === undefined) slots[h.level] = h.slots;

  // Group the numbered fields of each spell row (spellName3, spellSource3, ...).
  const rows = new Map<number, Map<string, PdfField>>();
  for (const f of fields) {
    const m = /^spell(Name|Source|SaveHit|CastingTime|Prepared|Page)(\d+)$/.exec(f.name);
    if (!m) continue;
    const row = rows.get(+m[2]!) ?? new Map<string, PdfField>();
    row.set(m[1]!, f);
    rows.set(+m[2]!, row);
  }

  const all: CharacterSpell[] = [];
  for (const [, row] of rows) {
    const nameField = row.get('Name');
    const raw = nameField?.value.trim();
    if (!nameField || !raw) continue;
    const val = (k: string): string => row.get(k)?.value.trim() ?? '';

    // The level is that of the last section header above the row, on this page or an earlier one.
    const header = [...headers].reverse().find((h) => readingOrder(h, nameField) <= 0);
    const hit = val('SaveHit');
    const save = /^([A-Za-z]{3})\s+(\d+)$/.exec(hit);
    const ability = save ? (save[1]!.toLowerCase() as Ability) : undefined;
    const source = val('Source');
    all.push({
      name: raw.replace(/\s*\[R\]\s*$/i, ''),
      source,
      level: header?.level ?? 0,
      alwaysPrepared: val('Prepared') === 'P' || /always prepared/i.test(source),
      ritual: /\[R\]/i.test(raw),
      castingTime: val('CastingTime'),
      ...(save && ability && (ABILITIES as readonly string[]).includes(ability) ? { save: { ability, dc: +save[2]! } } : {}),
      ...(parseSigned(hit) !== undefined ? { attackBonus: parseSigned(hit)! } : {}),
      page: val('Page'),
      inCombat: false,
    });
  }

  // The sheet lists some spells twice, as the 2014 and the 2024 version. Keep one per name,
  // preferring the 2024 version, then the one with a save or attack listed.
  const best = new Map<string, CharacterSpell>();
  for (const s of all) {
    const key = s.name.toLowerCase();
    const cur = best.get(key);
    const score = (x: CharacterSpell): number => (/2024/.test(x.page) ? 2 : 0) + (x.alwaysPrepared ? 1 : 0);
    if (!cur || score(s) > score(cur)) best.set(key, s);
  }
  if (best.size < all.length) notes.push(`${all.length - best.size} duplicate spell entries (2014 and 2024 versions) merged, preferring 2024`);
  return { spells: [...best.values()], slots };
}

function parseSpellcastingClasses(fields: PdfField[]): SpellcastingClass[] {
  const out = new Map<string, SpellcastingClass>();
  const byIndex = (prefix: string): Map<number, string> =>
    new Map(fields.flatMap((f) => (new RegExp(`^${prefix}(\\d+)$`).test(f.name) && f.value ? [[+/(\d+)$/.exec(f.name)![1]!, f.value] as const] : [])));
  const classes = byIndex('spellCastingClass');
  const abilities = byIndex('spellCastingAbility');
  const dcs = byIndex('spellSaveDC');
  const attacks = byIndex('spellAtkBonus');
  for (const [i, classText] of classes) {
    const names = classText.split('/').map((s) => s.trim());
    const split = (m: Map<number, string>): string[] => (m.get(i) ?? '').split('/').map((s) => s.trim());
    names.forEach((name, k) => {
      const ability = split(abilities)[k]?.slice(0, 3).toLowerCase();
      if (!name || !ability || !(ABILITIES as readonly string[]).includes(ability) || out.has(name)) return;
      out.set(name, { name, ability: ability as Ability, saveDC: parseSigned(split(dcs)[k]) ?? 0, attackBonus: parseSigned(split(attacks)[k]) ?? 0 });
    });
  }
  return [...out.values()];
}

/** Which of the sheet's fields are required before the character can be used in a fight. */
export function missingRequired(c: Character): string[] {
  const missing: string[] = [];
  if (!c.name) missing.push('name');
  if (c.classes.length === 0) missing.push('class and level');
  for (const ab of ABILITIES) if (!Number.isFinite(c.abilityScores[ab])) missing.push(`${ab} score`);
  if (!Number.isFinite(c.ac)) missing.push('armor class');
  if (!Number.isFinite(c.maxHp) || c.maxHp <= 0) missing.push('max HP');
  if (c.attacks.length === 0 && !c.spells.some((s) => s.inCombat)) missing.push('at least one attack or spell');
  return missing;
}

export interface SheetParse {
  character: Character;
  /** False when the PDF had no readable form fields at all (use the manual form instead). */
  readable: boolean;
}

/** Extra Attack: 2 attacks, 3 for a Fighter of level 11, 4 at level 20. */
function attacksPerAction(features: string, classes: CharacterClass[]): number {
  if (!/Extra Attack/i.test(features)) return 1;
  const fighter = classes.find((k) => /fighter/i.test(k.name))?.level ?? 0;
  return fighter >= 20 ? 4 : fighter >= 11 ? 3 : 2;
}

/** Turn a sheet's form fields into a Character, flagging what could not be read. */
export function parseCharacterSheet(fields: PdfField[]): SheetParse {
  const map = new Map<string, string>();
  for (const f of fields) if (!map.has(f.name)) map.set(f.name, f.value.trim());
  const get = (name: string): string => map.get(name) ?? '';
  const readable = fields.length > 0 && (map.has('CharacterName') || map.has('STR') || map.has('spellName0'));

  const warnings: string[] = [];
  const confidence: Record<string, Confidence> = {};
  const mark = (key: string, ok: boolean, level: Confidence = 'high'): void => void (confidence[key] = ok ? level : 'missing');

  const name = get('CharacterName');
  mark('name', !!name);
  const classes = parseClasses(get('CLASS LEVEL'));
  mark('classes', classes.length > 0);

  const abilityScores = {} as Record<Ability, number>;
  for (const ab of ABILITIES) {
    abilityScores[ab] = parseSigned(get(ab.toUpperCase())) ?? Number.NaN;
    mark(`ability.${ab}`, Number.isFinite(abilityScores[ab]));
  }

  // Saves: keep the totals that differ from the plain ability modifier.
  const saveBonuses: Partial<Record<Ability, number>> = {};
  for (const ab of ABILITIES) {
    const total = parseSigned(get(`ST ${ABILITY_NAMES[ab]}`));
    if (total !== undefined && Number.isFinite(abilityScores[ab]) && total !== abilityMod(abilityScores[ab])) saveBonuses[ab] = total;
  }

  const ac = parseSigned(get('AC')) ?? Number.NaN;
  const maxHp = parseSigned(get('MaxHP')) ?? Number.NaN;
  mark('ac', Number.isFinite(ac));
  mark('maxHp', Number.isFinite(maxHp));

  const dex = abilityScores.dex;
  const init = parseSigned(get('Init'));
  const initiativeBonus = init !== undefined && Number.isFinite(dex) ? init - abilityMod(dex) : 0;
  confidence.initiative = init !== undefined ? 'high' : 'low'; // missing: assume Dexterity only

  const sizeText = get('SIZE').toLowerCase();
  const size = (SIZES as readonly string[]).includes(sizeText) ? (sizeText as Size) : 'medium';
  if (!(SIZES as readonly string[]).includes(sizeText)) {
    confidence.size = 'low';
    warnings.push('Size not found on the sheet: assuming medium');
  }

  const defenses = parseDefenses(get('Defenses'), warnings);
  const attacks = parseAttacks(get, warnings);

  const featuresText = [...map.entries()]
    .filter(([k]) => /^(FeaturesTraits\d*|Actions\d*)$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, v]) => v)
    .filter(Boolean)
    .join('\n');
  const perAction = attacksPerAction(featuresText, classes);
  if (perAction > 1) {
    confidence.attacksPerAction = 'low';
    warnings.push(`Extra Attack found: weapon attacks are made ${perAction} times per Attack action`);
  } else confidence.attacksPerAction = 'high';

  const { spells, slots } = parseSpells(fields, warnings);
  const spellcasting = parseSpellcastingClasses(fields);
  mark('spells', spells.length > 0 || spellcasting.length === 0, 'high');
  if (Object.keys(slots).filter((l) => +l > 0).length === 0 && spells.some((s) => s.level > 0)) {
    warnings.push('Spell slots not found on the sheet');
    confidence.slots = 'missing';
  }

  const character: Character = {
    id: slugify(name || 'character'),
    name,
    species: get('RACE'),
    background: get('BACKGROUND'),
    classes,
    abilityScores,
    saveBonuses,
    proficiencyBonus: parseSigned(get('ProfBonus')) ?? 2,
    ac,
    maxHp,
    hitDice: get('Total'),
    initiativeBonus,
    speed: get('Speed'),
    size,
    ...defenses,
    attacks,
    attacksPerAction: perAction,
    spellcasting,
    spells,
    slots,
    profile: 'weakest',
    features: featuresText,
    confidence,
    warnings,
  };

  if (!readable) warnings.push('This PDF has no D&D Beyond character sheet form fields: fill in the character by hand');
  return { character, readable };
}
