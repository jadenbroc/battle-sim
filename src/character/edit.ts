import {
  ABILITIES,
  SIZES,
  isConditionName,
  isDamageType,
  type ConditionName,
  type DamageComponent,
  type DamageType,
  type Size,
  type TargetProfile,
} from '../engine/types';
import { slugify } from '../data/parseSrdMarkdown';
import type { Character, CharacterAttack, CharacterSpell, Confidence } from './characterTypes';
import { parseClasses, parseSheetDamage } from './parseCharacterSheet';

/** The party cap for Milestone 1. */
export const MAX_PARTY = 8;

export const PROFILES: readonly TargetProfile[] = ['weakest', 'threat', 'random'];

/** An empty character for the manual form: ordinary defaults for every field. */
export function blankCharacter(name = 'New character'): Character {
  return {
    id: slugify(name) || 'character',
    name,
    species: '',
    background: '',
    classes: [{ name: 'Fighter', level: 1 }],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveBonuses: {},
    proficiencyBonus: 2,
    ac: 10,
    maxHp: 10,
    hitDice: '',
    initiativeBonus: 0,
    speed: '30 ft.',
    size: 'medium',
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    conditionImmunities: [],
    attacks: [{ name: 'Weapon', toHit: 2, damage: [{ dice: '1d6', type: 'slashing' }], notes: '', range: 'melee', weapon: true }],
    attacksPerAction: 1,
    spellcasting: [],
    spells: [],
    slots: {},
    profile: 'weakest',
    features: '',
    confidence: {},
    warnings: [],
  };
}

/** A unique id for a new party member: the name's slug, numbered if taken. */
export function uniqueId(base: string, taken: readonly string[]): string {
  const slug = slugify(base) || 'character';
  if (!taken.includes(slug)) return slug;
  let n = 2;
  while (taken.includes(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

export const classesToText = (c: Pick<Character, 'classes'>): string => c.classes.map((k) => `${k.name} ${k.level}`).join(' / ');

export function damageToText(damage: readonly DamageComponent[]): string {
  return damage.map((d) => `${d.dice} ${d.type}`).join(' + ');
}

/** "fire, cold" -> damage types; unknown words are dropped. */
export function parseDamageTypes(text: string): DamageType[] {
  return [...new Set(text.toLowerCase().split(/[,;]/).map((s) => s.trim()).filter((s): s is DamageType => isDamageType(s)))];
}

export function parseConditionNames(text: string): ConditionName[] {
  return [...new Set(text.toLowerCase().split(/[,;]/).map((s) => s.trim()).filter((s): s is ConditionName => isConditionName(s)))];
}

/** Mark a field as checked by the user, so it stops being highlighted. */
export function markEdited(c: Character, key: string): void {
  c.confidence = { ...c.confidence, [key]: 'high' as Confidence };
}

export { parseClasses, parseSheetDamage };

/** Apply the text of an attack row's damage box. Returns false if no damage could be read. */
export function setAttackDamage(a: CharacterAttack, text: string): boolean {
  const damage = parseSheetDamage(text);
  if (damage.length === 0) return false;
  a.damage = damage;
  return true;
}

// ----- JSON import -----

export type Validation = { ok: true; character: Character } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a character read from a JSON file (an export of this app, or one written by hand) and fill
 * in anything optional. Returns the first problem found, in plain words.
 */
export function validateCharacter(value: unknown, opts: { lenient?: boolean } = {}): Validation {
  if (!isObj(value)) return { ok: false, error: 'a character must be a JSON object' };
  const v = value;
  // Lenient mode is for the app's own saved party: a character that still needs attention has
  // numbers it could not read, which JSON stores as null. They come back as NaN, still flagged.
  const num = (x: unknown): number | undefined => (isNum(x) ? x : opts.lenient && x === null ? Number.NaN : undefined);
  if (typeof v.name !== 'string' || v.name.trim() === '') return { ok: false, error: 'missing "name"' };
  const emptyClassesOk = opts.lenient === true && Array.isArray(v.classes) && v.classes.length === 0;
  if (!Array.isArray(v.classes) || (v.classes.length === 0 && !emptyClassesOk) || !v.classes.every((k) => isObj(k) && typeof k.name === 'string' && isNum(k.level) && k.level >= 1)) {
    return { ok: false, error: '"classes" must be a list like [{ "name": "Cleric", "level": 4 }]' };
  }
  const scores = v.abilityScores;
  if (!isObj(scores) || !ABILITIES.every((a) => num(scores[a]) !== undefined)) return { ok: false, error: '"abilityScores" needs str, dex, con, int, wis and cha as numbers' };
  const ac = num(v.ac);
  if (ac === undefined) return { ok: false, error: '"ac" must be a number' };
  const maxHp = num(v.maxHp);
  if (maxHp === undefined || (Number.isFinite(maxHp) && maxHp <= 0)) return { ok: false, error: '"maxHp" must be a positive number' };

  const attacks = Array.isArray(v.attacks) ? v.attacks : [];
  for (const a of attacks) {
    if (!isObj(a) || typeof a.name !== 'string' || num(a.toHit) === undefined || !Array.isArray(a.damage) || a.damage.length === 0) {
      return { ok: false, error: 'each attack needs "name", "toHit" and a non-empty "damage" list' };
    }
    for (const d of a.damage) {
      if (!isObj(d) || typeof d.dice !== 'string' || typeof d.type !== 'string' || !isDamageType(d.type)) return { ok: false, error: `attack "${a.name}" has an invalid damage entry` };
    }
  }

  const base = blankCharacter(v.name);
  const saves = isObj(v.saveBonuses) ? v.saveBonuses : {};
  const list = (x: unknown): string => (Array.isArray(x) ? x.join(',') : '');
  const character: Character = {
    ...base,
    name: v.name.trim(),
    id: typeof v.id === 'string' && v.id ? v.id : base.id,
    species: typeof v.species === 'string' ? v.species : '',
    background: typeof v.background === 'string' ? v.background : '',
    classes: (v.classes as { name: string; level: number }[]).map((k) => ({ name: k.name, level: Math.floor(k.level) })),
    abilityScores: Object.fromEntries(ABILITIES.map((a) => [a, num(scores[a]) as number])) as Character['abilityScores'],
    saveBonuses: Object.fromEntries(ABILITIES.filter((a) => isNum(saves[a])).map((a) => [a, saves[a] as number])) as Character['saveBonuses'],
    proficiencyBonus: isNum(v.proficiencyBonus) ? v.proficiencyBonus : 2,
    ac,
    maxHp,
    hitDice: typeof v.hitDice === 'string' ? v.hitDice : '',
    initiativeBonus: isNum(v.initiativeBonus) ? v.initiativeBonus : 0,
    speed: typeof v.speed === 'string' ? v.speed : '30 ft.',
    size: typeof v.size === 'string' && (SIZES as readonly string[]).includes(v.size) ? (v.size as Size) : 'medium',
    resistances: parseDamageTypes(list(v.resistances)),
    vulnerabilities: parseDamageTypes(list(v.vulnerabilities)),
    immunities: parseDamageTypes(list(v.immunities)),
    conditionImmunities: parseConditionNames(list(v.conditionImmunities)),
    attacks: attacks.map((a) => ({
      name: a.name as string,
      toHit: num(a.toHit) as number,
      damage: a.damage as DamageComponent[],
      notes: typeof a.notes === 'string' ? a.notes : '',
      range: a.range === 'ranged' ? 'ranged' : 'melee',
      weapon: a.weapon !== false,
    })),
    attacksPerAction: isNum(v.attacksPerAction) ? Math.min(4, Math.max(1, Math.floor(v.attacksPerAction))) : 1,
    spellcasting: Array.isArray(v.spellcasting)
      ? (v.spellcasting as Character['spellcasting']).filter((k) => isObj(k) && typeof k.name === 'string' && (ABILITIES as readonly string[]).includes(k.ability) && isNum(k.saveDC) && isNum(k.attackBonus))
      : [],
    spells: Array.isArray(v.spells)
      ? (v.spells as CharacterSpell[])
          .filter((s) => isObj(s) && typeof s.name === 'string')
          .map((s) => ({
            ...s,
            level: isNum(s.level) ? s.level : 0,
            inCombat: s.inCombat === true,
            source: typeof s.source === 'string' ? s.source : '',
            castingTime: typeof s.castingTime === 'string' ? s.castingTime : '1A',
            page: typeof s.page === 'string' ? s.page : '',
            alwaysPrepared: s.alwaysPrepared === true,
            ritual: s.ritual === true,
          }))
      : [],
    slots: isObj(v.slots) ? (Object.fromEntries(Object.entries(v.slots).filter(([l, n]) => /^[1-9]$/.test(l) && isNum(n) && n > 0)) as Record<number, number>) : {},
    profile: typeof v.profile === 'string' && (PROFILES as readonly string[]).includes(v.profile) ? (v.profile as TargetProfile) : 'weakest',
    features: typeof v.features === 'string' ? v.features : '',
    confidence: isObj(v.confidence)
      ? (Object.fromEntries(Object.entries(v.confidence).filter(([, c]) => c === 'high' || c === 'low' || c === 'missing')) as Record<string, Confidence>)
      : {},
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
  return { ok: true, character };
}

/** Read a JSON file's text as one character or a list of them. */
export function parseCharacterJson(text: string, opts: { lenient?: boolean } = {}): { characters: Character[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { characters: [], errors: ['not valid JSON'] };
  }
  const list = Array.isArray(data) ? data : [data];
  const characters: Character[] = [];
  const errors: string[] = [];
  list.forEach((item, i) => {
    const r = validateCharacter(item, opts);
    if (r.ok) characters.push(r.character);
    else errors.push(`character ${i + 1}: ${r.error}`);
  });
  return { characters, errors };
}
