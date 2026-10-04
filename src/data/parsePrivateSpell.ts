import { parseDice } from '../engine/dice';
import { EXCLUDED_BY_NAME_NOTE, SAVE_RE, excludedByName, parseArea, parseEffect, parseScaling } from './parseSpell';
import { slugify } from './parseSrdMarkdown';
import type { SpellDef } from './spellTypes';

// Converts a spell from the author's own markdown library (private data, never shipped):
//   ---
//   name: Toll the Dead
//   level: 0
//   school: Necromancy
//   classes: [Cleric, Warlock, Wizard]
//   save: wisdom
//   concentration: false
//   ritual: false
//   ---
//   **Casting Time:** 1 Action
//   **Range/Area:** 60 feet
//   **Components:** V, S
//   **Duration:** Instantaneous
//   ## Effect
//   ...paraphrased description...
//   ## Scaling
//   ...

export interface ParsedPrivateSpell {
  def: SpellDef;
  problems: string[];
}

const plain = (s: string): string => s.replace(/\*\*|_/g, '').replace(/\s+/g, ' ').trim();

function frontmatter(md: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/** "[Cleric, Warlock (Genie Patron)]" -> ["Cleric", "Warlock"]: the base class names. */
function classList(text: string | undefined): string[] {
  const inner = (text ?? '').replace(/^\[|\]$/g, '');
  return [...new Set(inner.split(',').map((c) => c.replace(/\(.*\)/, '').trim()).filter(Boolean))];
}

/** "1 Action" -> "Action", "1 Bonus Action" -> "Bonus Action", "1 Action (Ritual)" -> "Action or Ritual". */
function castingTime(text: string): string {
  const t = plain(text);
  const m = /^1\s+(action|bonus action|reaction)\b(.*)$/i.exec(t);
  if (!m) return t;
  const name = m[1]!.replace(/\b\w/g, (c) => c.toUpperCase());
  return /ritual/i.test(m[2]!) ? `${name} or Ritual` : name;
}

/** The text under a "## Heading", up to the next "## " heading or the end of the file. */
const ABILITY_WORDS: Record<string, string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  constitution: 'Constitution',
  intelligence: 'Intelligence',
  wisdom: 'Wisdom',
  charisma: 'Charisma',
};

/**
 * The author's descriptions often leave out what the frontmatter states ("attack: ranged spell
 * attack", "save: wisdom"). Where the text does not say it, add a plain sentence that does, so
 * the same effect parser can read both libraries. The sentence goes before the first outcome
 * sentence ("On a failed save, ..."), where the SRD wording would have it.
 */
export function withTypeSentences(text: string, fm: Record<string, string>): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const attack = /\b(ranged|melee)\s+spell attack\b/i.exec(fm.attack ?? '');
  if (attack && !/\b(?:ranged|melee) spell attack\b/i.test(text)) {
    return `Make a ${attack[1]!.toLowerCase()} spell attack. ${text}`;
  }
  const ability = ABILITY_WORDS[(fm.save ?? '').toLowerCase()];
  if (ability && !SAVE_RE.test(text)) {
    const area = /\b(?:each|every) creature\b/i.test(text);
    const synthetic = `${area ? 'Each creature' : 'The target'} makes a ${ability} saving throw.`;
    const at = sentences.findIndex((s) => /^On a (?:failed|successful) save|^On a failure|\bfailed save\b|\bfails? the save\b/i.test(s));
    if (at < 0) return `${synthetic} ${text}`;
    return [...sentences.slice(0, at), synthetic, ...sentences.slice(at)].join(' ');
  }
  return text;
}

function section(md: string, heading: string): string {
  const m = new RegExp(`(?:^|\\n)## ${heading}[ \\t]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`).exec(md);
  return m ? plain(m[1]!) : '';
}

export function parsePrivateSpell(rawMd: string): ParsedPrivateSpell {
  const md = rawMd.split('\r').join('');
  const problems: string[] = [];
  const fm = frontmatter(md);
  const name = fm.name ?? '';
  if (!name) problems.push('no name');
  const level = Number(fm.level);
  if (!Number.isInteger(level) || level < 0 || level > 9) problems.push(`bad level: ${fm.level}`);

  const field = (label: string): string => {
    const m = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm').exec(md);
    if (!m) problems.push(`missing ${label}`);
    return m ? plain(m[1]!) : '';
  };
  const rangeText = field('Range/Area');
  const duration = field('Duration');
  const text = section(md, 'Effect');
  // A spell cast as a Bonus Action whose attack is made later "as a Magic action" (Produce Flame)
  // is, for a fight, an attack you can make each turn: treat it as an Action spell.
  let time = castingTime(field('Casting Time'));
  if (time === 'Bonus Action' && /as a magic action/i.test(text) && /spell attack/i.test(text)) time = 'Action';
  if (!text) problems.push('no Effect section');

  let scalingText: string | undefined = section(md, 'Scaling');
  if (/^no (?:spell-slot )?scaling/i.test(scalingText)) scalingText = undefined;

  const concentration = fm.concentration === 'true' || /concentration/i.test(duration);
  const notes: string[] = [];
  // Parse the effect first, then the scaling (some texts say "one die" and need the damage's die size).
  const effect = excludedByName(name)
    ? (notes.push(EXCLUDED_BY_NAME_NOTE), undefined)
    : parseEffect(withTypeSentences(text, fm), time, duration, concentration, undefined, notes);
  const firstDice = effect && (effect.kind === 'attack' || effect.kind === 'save') ? effect.damage[0]?.dice : undefined;
  const baseSides = firstDice ? parseDice(firstDice).sides : undefined;
  const scaling = parseScaling(level > 0 ? scalingText : undefined, level === 0 ? scalingText : undefined, notes, baseSides);
  if (effect && scaling) effect.scaling = scaling;
  // "Each creature in the cone": the size is in the range field ("Self (15-foot cone)").
  if (effect?.kind === 'save' && !effect.area && /\b(?:each|every) creature\b/i.test(text)) {
    const area = parseArea(rangeText);
    if (area) effect.area = area;
  }

  const def: SpellDef = {
    id: slugify(name),
    name,
    level: Number.isInteger(level) ? level : 0,
    school: fm.school ?? '',
    classes: classList(fm.classes),
    castingTime: time,
    range: rangeText,
    components: field('Components'),
    duration,
    concentration,
    ritual: fm.ritual === 'true' || /ritual/i.test(time),
    text,
    ...(level > 0 && scalingText ? { higher: scalingText } : {}),
    ...(level === 0 && scalingText ? { cantripUpgrade: scalingText } : {}),
    ...(effect ? { effect } : {}),
    notes,
    private: true,
  };
  if (!def.school) problems.push('no school');
  return { def, problems };
}
