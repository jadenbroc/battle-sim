import { ABILITIES, abilityMod, isDamageType, SIZES, type Ability } from '../engine/types';
import type { MonsterDef, MonsterFeature } from './monsterTypes';
import { classifyActions, clean, damageAverageProblems, damageTypes } from './parseMonster';
import { slugify } from './parseSrdMarkdown';

// Converts a monster from the author's own markdown library (private data, never shipped):
//   ---
//   name: Wolf / size: Medium / type: Beast / alignment: Unaligned / cr: "1/4" / xp: 50
//   ---
//   **Size/Type/Alignment:** Medium Beast, Unaligned
//   **Armor Class:** 14 (natural armor)
//   **Hit Points:** 11 (2d8 + 2)
//   **Ability Scores:**
//   | STR | DEX | CON | INT | WIS | CHA |
//   | 14 (+2) | 15 (+2) | 12 (+1) | 3 (-4) | 12 (+1) | 6 (-2) |
//   **Saving Throws:** Str +2, Dex +2, ...      **Damage Resistances:** ...      **Challenge Rating:** 1/4 (50 XP)
//   ## Actions
//   Bite — melee attack, +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.
// The files come from several sources, so attack and save wording varies; it is normalized to the
// SRD wording the action parser reads.

export interface ParsedPrivateMonster {
  def: MonsterDef;
  /** Data problems: unreadable fields, numbers that disagree with each other. */
  problems: string[];
}

const ABBR: Record<string, Ability> = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
const TITLE: Record<string, string> = { melee: 'Melee', ranged: 'Ranged', 'melee or ranged': 'Melee or Ranged' };

function frontmatter(md: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^"|"$/g, '');
  }
  return out;
}

/**
 * Bring the author's attack and save wording to the SRD wording ("Melee Attack Roll: +4, reach
 * 5 ft. Hit: ..."). `estimate` is the attack bonus to use when an entry gives none; `onEstimate`
 * is told when it was used.
 */
export function normalizeActionText(text: string, estimate?: number, onEstimate?: () => void): string {
  let t = text
    // "melee attack, +4 to hit" / "Melee Attack: +4 to hit" / "Melee Attack Roll: +4"
    .replace(/\b(melee or ranged|melee|ranged)\s+attack(?:\s+roll)?\s*[,:]?\s*([+-]\d+)(?:\s+to hit)?/gi, (_m, kind: string, bonus: string) => `${TITLE[kind.toLowerCase()]} Attack Roll: ${bonus}`)
    // "Melee attack, reach 10 ft." with no bonus at all
    .replace(/\b(melee or ranged|melee|ranged)\s+attack(?:\s+roll)?\s*[,:]?\s*(?=reach|range)/gi, (_m, kind: string) => {
      if (estimate === undefined) return _m;
      onEstimate?.();
      return `${TITLE[kind.toLowerCase()]} Attack Roll: ${estimate >= 0 ? '+' : ''}${estimate}, `;
    })
    // "Dexterity saving throw, DC 19," / "Strength saving throw (DC 13)"
    .replace(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw\s*(?:[,:]\s*DC\s*(\d+)|\(\s*DC\s*(\d+)\s*\)\s*[,:]?)/gi, (_m, a: string, dc1: string | undefined, dc2: string | undefined) => `${a[0]!.toUpperCase()}${a.slice(1).toLowerCase()} Saving Throw: DC ${dc1 ?? dc2},`)
    .replace(/\bOn a (?:failure|failed save)\s*,?\s*/gi, 'Failure: ')
    .replace(/\bOn a (?:success|successful save)\s*,?\s*/gi, 'Success: ')
    // "(1d10 + 5) Slashing plus 7 (2d6) Necrotic damage": the first type is missing "damage"
    .replace(/(\(\d+d\d+(?:\s*[+-]\s*\d+)?\))\s+([A-Za-z]+)\s+(plus|and)\b/g, '$1 $2 damage $3');
  // "Melee Attack Roll: +8, reach 10 ft. 14 (2d8 + 5) Thunder damage." has no "Hit:" label.
  if (!/\bHit:/.test(t)) t = t.replace(/(Attack Roll:\s*[+-]\d+,[^.]*?ft\.(?:[^.]*?ft\.)?)\s+(?=\d)/, '$1 Hit: ');
  return t;
}

/** The text under a "## Heading" (which may carry a suffix such as "(3/Turn)"), up to the next heading. */
function sectionBody(md: string, heading: string): string {
  const m = new RegExp(`(?:^|\\n)## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`).exec(md);
  return m ? m[1]! : '';
}

/** Entries are paragraphs of the form "Name — text", possibly wrapped over several lines. */
function entries(body: string, normalize: (text: string, name: string) => string = (t) => t): MonsterFeature[] {
  const out: MonsterFeature[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const text = para.replace(/\*\*|\*|_/g, '').replace(/\s+/g, ' ').trim();
    if (!text || /^none\.?$/i.test(text)) continue;
    const m = /^(.+?)\s+[—–]\s+(.*)$/.exec(text) ?? /^([^.]{1,60})\.\s+(.*)$/.exec(text);
    if (m) out.push({ name: m[1]!.trim(), text: normalize(m[2]!.trim(), m[1]!.trim()) });
  }
  return out;
}

function field(md: string, label: string): string | undefined {
  const m = new RegExp(`^\\*\\*${label}:\\*\\*[ \\t]*(.*)$`, 'm').exec(md);
  return m ? m[1]!.replace(/\*\*|_/g, '').trim() : undefined;
}

const listOf = (text: string | undefined): string[] =>
  !text || /^none\b/i.test(text) ? [] : text.split(/,\s*(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);

/** Proficiency bonus from challenge rating. */
function proficiencyFor(cr: number): number {
  return cr < 5 ? 2 : cr < 9 ? 3 : cr < 13 ? 4 : cr < 17 ? 5 : cr < 21 ? 6 : cr < 25 ? 7 : cr < 29 ? 8 : 9;
}

export function parsePrivateMonster(rawMd: string): ParsedPrivateMonster {
  const md = rawMd.split('\r').join('');
  const problems: string[] = [];
  const fm = frontmatter(md);
  const name = fm.name ?? '';
  if (!name) problems.push('no name');

  // Type line: "Small or Medium Humanoid (Wizard), Neutral".
  const typeLine = field(md, 'Size/Type/Alignment') ?? '';
  const tm = /^(.+?)\s+([A-Z][A-Za-z]+(?:\s+of\s+[A-Za-z ]+?)?)(?:\s*\(([^)]+)\))?,\s*(.+)$/.exec(typeLine);
  const sizeText = (fm.size ?? tm?.[1] ?? '').toLowerCase();
  const size = sizeText.split(/\s+or\s+/)[0]!;
  if (!(SIZES as readonly string[]).includes(size)) problems.push(`unknown size: ${sizeText}`);
  const type = (fm.type ?? tm?.[2] ?? '').toLowerCase();
  const subtype = tm?.[3]?.toLowerCase();

  // AC and HP.
  const ac = /(\d+)/.exec(field(md, 'Armor Class') ?? '');
  const hp = /(\d+)\s*\(\s*([^)]+?)\s*\)/.exec(field(md, 'Hit Points') ?? '');
  if (!ac) problems.push('no Armor Class');
  if (!hp) problems.push('no Hit Points');

  // Abilities: the first table row with six "N (+M)" cells.
  const row = md.split('\n').find((l) => (l.match(/\d+\s*\(\s*[+\-−]?\d+\s*\)/g) ?? []).length === 6);
  const cells = row ? [...row.matchAll(/(\d+)\s*\(\s*([+\-−]?\d+)\s*\)/g)] : [];
  const scores = {} as Record<Ability, number>;
  const mods = {} as Record<Ability, number>;
  ABILITIES.forEach((a, i) => {
    scores[a] = cells[i] ? +cells[i]![1]! : Number.NaN;
    mods[a] = cells[i] ? parseInt(cells[i]![2]!.replace('−', '-'), 10) : Number.NaN;
  });
  if (cells.length !== 6) problems.push('ability scores not readable');
  else for (const a of ABILITIES) if (mods[a] !== abilityMod(scores[a])) problems.push(`${a} modifier ${mods[a]} does not match score ${scores[a]}`);

  // Saving throws: "Str +2, Dex +2" -> keep totals that differ from the ability modifier.
  const saveBonuses: Partial<Record<Ability, number>> = {};
  for (const m of (field(md, 'Saving Throws') ?? '').matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)[a-z]*\s*([+\-−]\d+)/gi)) {
    const ab = ABBR[m[1]!.toLowerCase()]!;
    const total = parseInt(m[2]!.replace('−', '-'), 10);
    if (Number.isFinite(mods[ab]) && total !== mods[ab]) saveBonuses[ab] = total;
  }

  // Challenge rating.
  const crLine = field(md, 'Challenge Rating') ?? '';
  const cr = fm.cr ?? /^([\d/]+)/.exec(crLine)?.[1] ?? '';
  const crValue = cr.includes('/') ? +cr.split('/')[0]! / +cr.split('/')[1]! : Number(cr);
  if (!cr || !Number.isFinite(crValue)) problems.push('no challenge rating');
  const xp = Number(fm.xp) || parseInt((/([\d,]+)\s*XP/.exec(crLine)?.[1] ?? '0').replace(/,/g, ''), 10);
  const pb = /PB \+(\d+)/.exec(crLine);

  // Defenses. A combined "Immunities" line puts damage types before ";" and conditions after.
  const notes: string[] = [];
  const resistances = [...listOf(field(md, 'Damage Resistances')), ...listOf(field(md, 'Resistances'))];
  const vulnerabilities = listOf(field(md, 'Damage Vulnerabilities'));
  const immunities = listOf(field(md, 'Damage Immunities'));
  const conditionImmunities = listOf(field(md, 'Condition Immunities'));
  const combined = field(md, 'Immunities');
  if (combined && !/^none\b/i.test(combined)) {
    let damage = '';
    let conditions = '';
    if (combined.includes(';')) [damage = '', conditions = ''] = combined.split(';').map((s) => s.trim());
    else if (listOf(combined).every((x) => isDamageType(x.toLowerCase()))) damage = combined;
    else conditions = combined;
    immunities.push(...listOf(damage));
    conditionImmunities.push(...listOf(conditions));
  }

  // An attack with no bonus in the source gets proficiency + the better of Strength and Dexterity.
  const proficiency = pb ? +pb[1]! : proficiencyFor(crValue);
  const estimate = Number.isFinite(mods.str) && Number.isFinite(mods.dex) ? proficiency + Math.max(mods.str, mods.dex) : undefined;
  const normalize = (text: string, entryName: string): string =>
    normalizeActionText(text, estimate, () => notes.push(`${entryName}: attack bonus not in the source, estimated as +${estimate} (proficiency + best of Str and Dex)`));

  const actionEntries = entries(sectionBody(md, 'Actions'), normalize);
  const actionPart = classifyActions(actionEntries, notes);
  const bonusEntries = entries(sectionBody(md, 'Bonus Actions'), normalize);
  const bonusPart = classifyActions(bonusEntries, notes, { bonus: true });
  for (const e of [...actionEntries, ...bonusEntries]) for (const msg of damageAverageProblems(e.text)) problems.push(`${e.name}: ${msg}`);

  const hitDice = (hp?.[2] ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-');
  const hd = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(hitDice);
  if (hp && hd) {
    const avg = (+hd[1]! * (+hd[2]! + 1)) / 2 + (hd[3] ? (hd[3] === '-' ? -1 : 1) * +hd[4]! : 0);
    if (Math.floor(avg) !== +hp[1]!) problems.push(`HP ${hp[1]} does not match hit dice ${hitDice}`);
  } else if (hp) problems.push(`unreadable hit dice: ${hitDice}`);

  const def: MonsterDef = {
    id: slugify(name),
    name,
    size,
    type,
    ...(subtype ? { subtype } : {}),
    alignment: fm.alignment ?? tm?.[4] ?? '',
    cr,
    crValue,
    xp,
    proficiencyBonus: proficiency,
    ac: ac ? +ac[1]! : Number.NaN,
    hp: hp ? +hp[1]! : Number.NaN,
    hitDice,
    abilityScores: scores,
    saveBonuses,
    initiativeBonus: 0, // the source has no initiative line: Dexterity only
    resistances: damageTypes(resistances, 'Resistance', notes),
    vulnerabilities: damageTypes(vulnerabilities, 'Vulnerability', notes),
    immunities: damageTypes(immunities, 'Immunity', notes),
    conditionImmunities: conditionImmunities.map((c) => clean(c).replace(/\s+conditions?$/i, '')),
    ...actionPart,
    actions: [...actionPart.actions, ...bonusPart.actions],
    traits: entries(sectionBody(md, 'Traits')),
    bonusActions: bonusPart.otherActions,
    reactions: entries(sectionBody(md, 'Reactions')),
    legendaryActions: entries(sectionBody(md, 'Legendary Actions')),
    otherActions: [...actionPart.otherActions, ...entries(sectionBody(md, 'Spellcasting'))],
    notes,
    private: true,
  };
  return { def, problems };
}
