import { ABILITIES, abilityMod, type Ability } from '../engine/types';
import type { MonsterDef, MonsterFeature } from './monsterTypes';
import { classifyActions, clean, damageAverageProblems, damageTypes } from './parseMonster';

// Parses stat blocks from the SRD 5.2.1 markdown (github.com/downfallx/dnd-5e-srd-markdown).
// A block looks like:
//   ### Goblin Warrior
//   _Small Fey (Goblinoid), Chaotic Neutral_
//   **AC** 15 **Initiative** +2 (12) <br>
//   **HP** 10 (3d6) <br>
//   ... HTML ability table ...
//   **CR** 1/4 (XP 50; PB +2)
//   #### Actions
//   **_Scimitar._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage.

const SECTIONS = ['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions'];
const SIZES = '(?:Tiny|Small|Medium|Large|Huge|Gargantuan)';

export interface ParsedBlock {
  def: MonsterDef;
  /** Problems found while parsing; empty for a clean block. */
  problems: string[];
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Strip markdown and HTML bits used in the stat block text. */
function plain(s: string): string {
  return clean(s.replace(/<br\s*\/?>/gi, ' ').replace(/&emsp;/g, ' ').replace(/\*\*|_/g, ''));
}

/** Split the markdown into stat blocks: lists of lines starting at the monster's heading. */
export function splitBlocks(lines: readonly string[]): string[][] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{2,4}\s+\S/.test(lines[i]!)) continue;
    const next = lines.slice(i + 1, i + 6).filter((l) => l.trim() !== '');
    if (next[0] && /^_.*,.*_\s*$/.test(next[0]) && next.slice(1).some((l) => /^\*\*AC\*\*/.test(l))) starts.push(i);
  }

  return starts.map((start) => {
    let end = start + 1;
    while (end < lines.length) {
      const h = /^#{1,6}\s+(.+?)\s*$/.exec(lines[end]!);
      if (h && !SECTIONS.includes(h[1]!)) break; // next monster, or a heading of an outer section
      end++;
    }
    return lines.slice(start, end) as string[];
  });
}

function parseTypeLine(line: string): { size: string; type: string; subtype?: string; alignment: string } | null {
  const m = new RegExp(`^_(${SIZES}(?: or ${SIZES})?) (.+?)(?: \\(([^)]+)\\))?,\\s*(.+?)_\\s*$`).exec(line.trim());
  if (!m) return null;
  let type = m[2]!.toLowerCase();
  if (type.startsWith('swarm of')) type = type.split(' ').pop()!.replace(/s$/, ''); // "Swarm of Tiny Beasts"
  return { size: m[1]!.toLowerCase(), type, ...(m[3] ? { subtype: m[3].toLowerCase() } : {}), alignment: m[4]! };
}

function parseAbilityTable(block: string): Record<Ability, { score: number; mod: number; save: number }> | null {
  const out: Partial<Record<Ability, { score: number; mod: number; save: number }>> = {};
  const num = (s: string): number => parseInt(s.replace(/[−–]/g, '-').replace('+', ''), 10);
  const re = /<strong>(STR|DEX|CON|INT|WIS|CHA)<\/strong><\/td>\s*<td>(\d+)<\/td>\s*<td>([+\-−–]?\d+)<\/td>\s*<td>([+\-−–]?\d+)<\/td>/g;
  for (const m of block.matchAll(re)) {
    const ab = m[1]!.toLowerCase() as Ability;
    if (!out[ab]) out[ab] = { score: +m[2]!, mod: num(m[3]!), save: num(m[4]!) }; // first table only
  }
  return ABILITIES.every((a) => out[a]) ? (out as Record<Ability, { score: number; mod: number; save: number }>) : null;
}

/** Entries of one section: "**_Name._** text" plus any continuation lines. */
function entriesOf(lines: readonly string[]): MonsterFeature[] {
  const out: MonsterFeature[] = [];
  for (const line of lines) {
    const m = /^\*\*_(.+?)\._\*\*\s*(.*)$/.exec(line.trim());
    if (m) out.push({ name: plain(m[1]!), text: plain(m[2]!) });
    else if (out.length > 0 && line.trim() !== '' && !/^_.*_$/.test(line.trim())) {
      const last = out[out.length - 1]!;
      last.text = clean(`${last.text} ${plain(line)}`);
    }
  }
  return out;
}

export type AbilityTable = Record<Ability, { score: number; mod: number; save: number }>;

/**
 * Parse one stat block. `overrideTable` replaces the ability table for blocks whose table is
 * scrambled in the source markdown.
 */
export function parseSrdBlock(lines: readonly string[], overrideTable?: AbilityTable): ParsedBlock {
  const problems: string[] = [];
  const name = /^#+\s+(.+?)\s*$/.exec(lines[0]!)![1]!;
  const fail = (msg: string): void => void problems.push(msg);
  const block = lines.join('\n');
  const body = lines.filter((l) => l.trim() !== '');

  const typeLine = parseTypeLine(body[1] ?? '');
  if (!typeLine) fail(`could not read the type line: ${body[1]}`);

  const field = (label: string): string | undefined => {
    const line = body.find((l) => l.startsWith(`**${label}**`));
    return line ? plain(line.replace(`**${label}**`, '')) : undefined;
  };

  const ac = /\*\*AC\*\*\s*(\d+)/.exec(block);
  const init = /\*\*Initiative\*\*\s*([+\-−]?\d+)/.exec(block);
  const hp = /\*\*HP\*\*\s*(\d+)\s*\(([^)]+)\)/.exec(block);
  // "CR 1/4 (XP 50; PB +2)", "CR 17 (XP 18,000, or 20,000 in lair; PB +6)" or "CR 3 (700 XP; PB +2)"
  const cr = /\*\*CR\*\*\s*([\d/]+)\s*\((?:XP ([\d,]+)|([\d,]+) XP)(?:,[^;]*)?;\s*PB \+(\d+)\)/.exec(block);
  if (!ac) fail('no AC');
  if (!hp) fail('no HP');
  if (!cr) fail('no CR line');
  const table = overrideTable ?? parseAbilityTable(block);
  if (!table) fail('ability table not readable');

  if (!typeLine || !ac || !hp || !cr || !table) {
    return { def: { id: slugify(name), name } as MonsterDef, problems };
  }

  for (const ab of ABILITIES) {
    if (table[ab].mod !== abilityMod(table[ab].score)) fail(`${ab} modifier ${table[ab].mod} does not match score ${table[ab].score}`);
  }

  const abilityScores = Object.fromEntries(ABILITIES.map((a) => [a, table[a].score])) as Record<Ability, number>;
  const saveBonuses: Partial<Record<Ability, number>> = {};
  for (const ab of ABILITIES) if (table[ab].save !== table[ab].mod) saveBonuses[ab] = table[ab].save;

  const notes: string[] = [];

  // Sections: split the lines after the CR line by "#### Heading".
  const crIndex = lines.findIndex((l) => l.startsWith('**CR**'));
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(crIndex + 1)) {
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1]!;
      sections.set(current, []);
    } else if (current) sections.get(current)!.push(line);
  }
  const section = (n: string): MonsterFeature[] => entriesOf(sections.get(n) ?? []);

  const actionEntries = section('Actions');
  const bonusEntries = section('Bonus Actions');
  const actionPart = classifyActions(actionEntries, notes);
  const bonusPart = classifyActions(bonusEntries, notes, { bonus: true });
  for (const e of [...actionEntries, ...bonusEntries]) {
    for (const msg of damageAverageProblems(e.text)) problems.push(`${e.name}: ${msg}`);
  }

  // Immunities: "Necrotic, Poison; Charmed, Exhaustion" (damage types, then conditions).
  const immunityText = field('Immunities') ?? '';
  const [immDamage = '', immConditions = ''] = immunityText.includes(';')
    ? immunityText.split(';').map((s) => s.trim())
    : /^(?:(?:acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)(?:,\s*)?)+$/i.test(immunityText)
      ? [immunityText, '']
      : ['', immunityText];
  const list = (s: string | undefined): string[] => (s ? s.split(/,\s*(?![^(]*\))/).map((x) => x.trim()).filter(Boolean) : []);

  const hitDice = hp[2]!.replace(/\s+/g, '').replace(/[−–]/g, '-');
  const def: MonsterDef = {
    id: slugify(name),
    name,
    size: typeLine.size,
    type: typeLine.type,
    ...(typeLine.subtype ? { subtype: typeLine.subtype } : {}),
    alignment: typeLine.alignment,
    cr: cr[1]!,
    crValue: cr[1]!.includes('/') ? +cr[1]!.split('/')[0]! / +cr[1]!.split('/')[1]! : +cr[1]!,
    xp: parseInt((cr[2] ?? cr[3]!).replace(/,/g, ''), 10),
    proficiencyBonus: +cr[4]!,
    ac: +ac[1]!,
    hp: +hp[1]!,
    hitDice,
    abilityScores,
    saveBonuses,
    initiativeBonus: init ? parseInt(init[1]!.replace(/−/g, '-').replace('+', ''), 10) - table.dex.mod : 0,
    resistances: damageTypes(list(field('Resistances')), 'Resistance', notes),
    vulnerabilities: damageTypes(list(field('Vulnerabilities')), 'Vulnerability', notes),
    immunities: damageTypes(list(immDamage), 'Immunity', notes),
    conditionImmunities: list(immConditions),
    ...actionPart,
    actions: [...actionPart.actions, ...bonusPart.actions],
    traits: section('Traits'),
    bonusActions: bonusPart.otherActions,
    reactions: section('Reactions'),
    legendaryActions: section('Legendary Actions'),
    notes,
  };

  // The printed average HP should match the hit dice (the SRD rounds down).
  const hd = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(hitDice);
  if (hd) {
    const avg = (+hd[1]! * (+hd[2]! + 1)) / 2 + (hd[3] ? (hd[3] === '-' ? -1 : 1) * +hd[4]! : 0);
    if (Math.floor(avg) !== def.hp) problems.push(`HP ${def.hp} does not match hit dice ${hitDice} (average ${avg})`);
  } else fail(`unreadable hit dice: ${hitDice}`);

  return { def, problems };
}

