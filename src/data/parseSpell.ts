import { isDamageType, type Ability, type ConditionEffect, type DamageComponent, type DamageType } from '../engine/types';
import { clean, parseConditionEffects } from './parseMonster';
import { slugify } from './parseSrdMarkdown';
import type { SpellArea, SpellDef, SpellEffect, SpellScaling } from './spellTypes';

// Parses spells from the SRD 5.2.1 markdown (github.com/downfallx/dnd-5e-srd-markdown). A spell is:
//   #### Fireball
//   _Level 3 Evocation (Sorcerer, Wizard)_      or      _Evocation Cantrip (Sorcerer, Wizard)_
//   **Casting Time:** Action
//   **Range:** 150 feet
//   **Components:** V, S, M (a ball of bat guano and sulfur)
//   **Duration:** Instantaneous
//   ...description...
//   _Using a Higher-Level Spell Slot._ The damage increases by 1d6 for each spell slot level above 3.
//   _Cantrip Upgrade._ ...

const ABILITY_BY_NAME: Record<string, Ability> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
  str: 'str',
  dex: 'dex',
  con: 'con',
  int: 'int',
  wis: 'wis',
  cha: 'cha',
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

// "Dexterity saving throw" (SRD) or "WIS save" (the author's library).
export const SAVE_RE = /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|STR|DEX|CON|INT|WIS|CHA)\s+(?:saving throws?|saves?)\b/i;
const DAMAGE_RE = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([A-Za-z]+)\s+damage/g;
const PROJECTILE = '(?:rays?|beams?|darts?|bolts?|missiles?)';

/** Split the markdown into spell blocks: lists of lines starting at the spell's heading. */
export function splitSpellBlocks(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#### \S/.test(lines[i]!)) continue;
    const next = lines.slice(i + 1, i + 4).find((l) => l.trim() !== '') ?? '';
    if (!/^_(?:Level \d|[A-Za-z]+ Cantrip)/.test(next)) continue;
    let end = i + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end]!)) end++;
    blocks.push(lines.slice(i, end) as string[]);
  }
  return blocks;
}

const plain = (s: string): string => clean(s.replace(/\*\*|_/g, ''));

/**
 * Damage components from the start of `text`: "8d6 Fire damage", chained with "and"/"plus". A
 * component that happens later ("... and 2d4 Acid damage at the end of its next turn") or is a
 * separate extra ("and another 5d4 ...") is not part of the initial damage.
 */
export function parseSpellDamage(text: string): DamageComponent[] {
  const t = clean(text);
  const parts: DamageComponent[] = [];
  let lastEnd = -1;
  DAMAGE_RE.lastIndex = 0;
  for (let m = DAMAGE_RE.exec(t); m; m = DAMAGE_RE.exec(t)) {
    const type = m[2]!.toLowerCase();
    if (lastEnd >= 0 && !/^\s*,?\s*(and|plus)\s*$/i.test(t.slice(lastEnd, m.index))) break;
    if (!isDamageType(type)) break;
    if (/^\s*at the (?:end|start) of/i.test(t.slice(m.index + m[0].length))) break; // delayed damage
    lastEnd = m.index + m[0].length;
    parts.push({ dice: m[1]!.replace(/\s+/g, ''), type: type as DamageType });
  }
  return parts;
}

const DAMAGE_ANYWHERE = /\d+d\d+(?:\s*[+-]\s*\d+)?\s+[A-Za-z]+ damage/;

/**
 * The save sentence plus the sentences that spell out its outcome ("On a failed save, ...",
 * "On a successful save, ..."). Damage elsewhere in the spell (a later option, a lasting effect)
 * is not part of the save.
 */
function saveBlock(text: string, saveIndex: number): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  let pos = 0;
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (saveIndex < pos + sentences[i]!.length + 1) {
      start = i;
      break;
    }
    pos += sentences[i]!.length + 1;
  }
  const out = [sentences[start]!];
  for (let i = start + 1; i < sentences.length && /^(?:On a (?:failed|successful) save|On a (?:failure|success)|A (?:creature|target) that (?:fails|succeeds))/i.test(sentences[i]!); i++) {
    out.push(sentences[i]!);
  }
  return out.join(' ');
}

/** "20-foot-radius Sphere", "15-foot Cone", "100-foot-long, 5-foot-wide Line". */
export function parseArea(text: string): SpellArea | undefined {
  const m = /(\d+)-foot(?:-radius|-long)?(?:,\s*\d+-foot-wide)?\s+(Cone|Cube|Sphere|Line|Cylinder|Emanation)\b/i.exec(clean(text));
  return m ? { shape: m[2]!.toLowerCase() as SpellArea['shape'], size: +m[1]! } : undefined;
}

function durationRounds(duration: string): number | undefined {
  const d = clean(duration);
  const rounds = /(\d+) rounds?/i.exec(d);
  if (rounds) return +rounds[1]!;
  const minutes = /(?:up to )?(\d+) minutes?/i.exec(d);
  if (minutes) return 10 * +minutes[1]!;
  const hours = /(?:up to )?(\d+) hours?/i.exec(d);
  if (hours) return 600 * +hours[1]!;
  return undefined;
}

/** Conditions in a spell's save sentence. "For the duration" becomes the spell's own length. */
function spellConditions(text: string, ability: Ability | undefined, duration: string): ConditionEffect[] {
  // dc 0 stands for "the caster's spell save DC", filled in when the spell is converted.
  const effects = parseConditionEffects(text, ability ? { ability, dc: 0 } : undefined);
  const rounds = durationRounds(duration);
  return effects.map((e) =>
    e.duration.kind === 'indefinite' && rounds !== undefined ? { ...e, duration: { kind: 'rounds', n: rounds } } : e,
  );
}

/** Scaling paragraphs: "The damage increases by 1d6 for each spell slot level above 3." etc. */
export function parseScaling(
  higher: string | undefined,
  cantrip: string | undefined,
  notes: string[],
  /** Die size of the spell's damage, for texts that say "one die at level 5" without naming it. */
  baseSides?: number,
): SpellScaling | undefined {
  const scaling: SpellScaling = {};

  if (higher) {
    const h = clean(higher);
    const slot = '(?:spell )?slot level above (\\d)';
    const damage = new RegExp(`damage (?:\\([^)]*\\) )?increases by (\\d+d\\d+) for each ${slot}`, 'i').exec(h);
    const healing = new RegExp(`healing increases by (\\d+d\\d+) for each ${slot}`, 'i').exec(h);
    const extra = new RegExp(`(one|two|three) (?:more|additional) ${PROJECTILE} for each ${slot}`, 'i').exec(h);
    const moreTargets = new RegExp(`(?:target|affect) (one|two|three) (?:more|additional) (?:creatures?|targets?) for each ${slot}`, 'i').exec(h);
    if (damage) scaling.upcast = { above: +damage[2]!, damageDice: damage[1]! };
    else if (moreTargets) scaling.upcast = { above: +moreTargets[2]!, targets: NUMBER_WORDS[moreTargets[1]!.toLowerCase()]! };
    else if (healing) scaling.upcast = { above: +healing[2]!, healDice: healing[1]! };
    else if (extra) scaling.upcast = { above: +extra[2]!, count: NUMBER_WORDS[extra[1]!.toLowerCase()]! };
    else notes.push(`Higher-level effect not simulated: ${h.slice(0, 100)}`);
  }

  if (cantrip) {
    const c = clean(cantrip);
    const num = '(one|two|three|four|five|six|\\d)';
    const toNum = (w: string): number => (/^\d$/.test(w) ? +w : NUMBER_WORDS[w.toLowerCase()]!);
    const damage = /damage increases by (\d+d\d+) when you reach levels? 5/i.exec(c);
    // "2d10 at level 5, 3d10 at level 11, ..." (the sides are those of the first number)
    const listed = /(\d+)d(\d+)(?:\/\d+d\d+)? at level 5\b/i.exec(c);
    const oneDie = /\b(?:one|an additional|another) die at level 5\b/i.exec(c);
    const beams = new RegExp(`${num} beams? at level 5, ${num} beams? at level 11, and ${num} beams? at level 17`, 'i').exec(c);
    const beamsListed = /additional beam at level 5 \((\d) beams?\), level 11 \((\d) beams?\), and level 17 \((\d) beams?\)/i.exec(c);
    if (damage) scaling.cantrip = { damageDice: damage[1]! };
    else if (beams) scaling.cantrip = { counts: [1, toNum(beams[1]!), toNum(beams[2]!), toNum(beams[3]!)] };
    else if (beamsListed) scaling.cantrip = { counts: [1, +beamsListed[1]!, +beamsListed[2]!, +beamsListed[3]!] };
    else if (listed) scaling.cantrip = { damageDice: `1d${listed[2]}` };
    else if (oneDie && baseSides) scaling.cantrip = { damageDice: `1d${baseSides}` };
    else if (!/range doubles/i.test(c)) notes.push(`Cantrip upgrade not simulated: ${c.slice(0, 100)}`);
  }

  return scaling.upcast || scaling.cantrip ? scaling : undefined;
}

/** Work out what the spell does, if the simulator can model it. */
export function parseEffect(
  text: string,
  castingTime: string,
  duration: string,
  concentration: boolean,
  scaling: SpellScaling | undefined,
  notes: string[],
): SpellEffect | undefined {
  if (!/^(Action|Bonus Action)\b/i.test(castingTime)) {
    notes.push(`Casting time "${castingTime}": not usable in a fight`);
    return undefined;
  }

  const t = clean(text);
  const hasDamage = DAMAGE_ANYWHERE.test(t);

  // Spells the simulator does not model: they act through a lasting area, are controlled on later
  // turns, trigger on your next weapon hit, offer a menu or a table, or buff a willing creature.
  const skip = (reason: string): undefined => {
    notes.push(reason);
    return undefined;
  };
  if (hasDamage && /enters? (?:the|that|an) (?:area|spell's area)|ends? (?:its|a) turn (?:there|in the)|starts? its turn (?:there|in the)|for the first time on a turn|moves? into/i.test(t)) {
    return skip('Zone or lasting area effect: not simulated');
  }
  if (/the next time (?:you|the caster) hits?|your next (?:weapon )?(?:attack|hit)|upon hitting|hits? (?:a creature |the target )?with a (?:melee )?weapon attack/i.test(t)) {
    return skip('Triggers on a later weapon hit: not simulated');
  }
  const repeats = concentration
    ? /at the start of each of (?:your|the caster's) turns|\b(?:later|subsequent) turns\b|until the spell ends,? (?:you|the caster) can (?:take|make|use)|can make the attack again|as an? (?:magic|bonus) action,? (?:you|the caster) can|ends? its turn within/i
    : /at the start of each of (?:your|the caster's) turns|\b(?:later|subsequent) turns\b/i;
  if (repeats.test(t)) {
    return skip('Controlled or repeating effect: not simulated');
  }
  if (/<table>|choose (?:one|a|the) (?:of the following|command|effect)|from these options|choose the command|consulting the/i.test(t)) {
    return skip('Spell offers a menu or table of effects: not simulated');
  }
  if (/\b(?:choose|touch) a willing creature|willing creature/i.test(t.slice(0, 220))) return skip('Buff on a willing creature: not simulated');

  const ongoing = hasDamage && /at the end of (?:each of )?(?:its|the target's) (?:next )?turns?|at the start of (?:each of )?its turns?|each time|damage again/i.test(t);
  const note = (): void => {
    if (ongoing) notes.push('Repeated or delayed damage is not simulated: only the initial effect is');
    if (/additional (?:creature|target|Beast|Humanoid)/i.test(text)) notes.push('Extra targets at higher levels are not simulated');
  };

  // A bonus die on allies: "You bless up to three creatures... adds 1d4 to the attack roll or save" (Bless).
  const bonusDie = /\badds? (\d+d\d+) to the attack roll(?: or (?:the )?(save|saving throw))?/i.exec(t);
  const upTo = /\bup to (one|two|three|four|five|six|seven|eight|nine) creatures?\b/i.exec(t);
  if (bonusDie && upTo && !hasDamage) {
    note();
    return {
      kind: 'buff',
      targets: NUMBER_WORDS[upTo[1]!.toLowerCase()]!,
      rollModifier: { dice: bonusDie[1]!, sign: 1, attacks: true, saves: !!bonusDie[2], rounds: durationRounds(duration) ?? 10 },
      ...(scaling ? { scaling } : {}),
    };
  }

  // Attack spells: "Make a ranged spell attack... On a hit, the target takes 1d10 Fire damage."
  const attack = /\b(ranged|melee) spell attack\b/i.exec(t);
  if (attack) {
    const afterHit = t.slice(Math.max(0, t.search(/on a hit/i)));
    // The damage usually follows "On a hit"; some texts put it before ("..., 1d8 fire damage on a hit").
    const fromDice = (s: string): string => s.slice(Math.max(0, s.search(/\d+d\d+/)));
    let damage = [afterHit, t.slice(attack.index)]
      .map((s) => parseSpellDamage(fromDice(s)))
      .find((d) => d.length > 0) ?? [];
    // The caster chooses the type: "Choose Acid, Cold, Fire, ... for the type" and "3d8 damage of the chosen type".
    let damageTypes: DamageType[] | undefined;
    const choice = /[Cc]hoose ((?:[A-Z][a-z]+,? (?:or |and )?)+)for the type/.exec(t);
    const chosenDice = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+damage of the chosen type/i.exec(t);
    if (damage.length === 0 && choice && chosenDice) {
      const types = choice[1]!.replace(/\b(?:or|and)\s+/g, '').split(/,\s*|\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (types.length > 0 && types.every(isDamageType)) {
        damageTypes = types as DamageType[];
        damage = [{ dice: chosenDice[1]!.replace(/\s+/g, ''), type: damageTypes[0]! }];
      }
    }
    if (damage.length === 0) {
      notes.push('Attack spell without parseable damage');
      return undefined;
    }
    const count = new RegExp(`(?:hurls?|creates?|conjures?|sends?|fires?|launch(?:es)?|releases?) (?:up to )?(one|two|three|four|five|six|seven|eight|nine) [\\w -]*?${PROJECTILE}`, 'i').exec(t);
    const effects = spellConditions(afterHit, undefined, duration);
    note();
    return {
      kind: 'attack',
      range: attack[1]!.toLowerCase() as 'melee' | 'ranged',
      damage,
      ...(damageTypes ? { damageTypes } : {}),
      ...(damageTypes && /leaps? to (?:a|another) different target/i.test(t) ? { leaps: true } : {}),
      ...(count && /for each/i.test(t) ? { count: NUMBER_WORDS[count[1]!.toLowerCase()]! } : {}),
      ...(effects.length ? { effects } : {}),
      ...(scaling ? { scaling } : {}),
    };
  }

  // Magic Missile style darts that never miss.
  if (/\bdarts?\b/i.test(t) && /strikes?/i.test(t) && hasDamage) {
    const count = /(one|two|three|four|five) (?:glowing )?darts/i.exec(t);
    note();
    return {
      kind: 'attack',
      range: 'ranged',
      autoHit: true,
      damage: parseSpellDamage(t.slice(t.search(/\d+d\d+/))),
      count: count ? NUMBER_WORDS[count[1]!.toLowerCase()]! : 1,
      ...(scaling ? { scaling } : {}),
    };
  }

  // Save spells.
  const save = SAVE_RE.exec(t);
  if (save) {
    const ability = ABILITY_BY_NAME[save[1]!.toLowerCase()]!;
    const block = saveBlock(t, save.index);
    const damage = parseSpellDamage(block.slice(Math.max(0, block.search(DAMAGE_ANYWHERE))));
    // A repeat-save clause is often its own sentence after the save block.
    const repeat = t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => /\brepeats? the (?:save|saving throw)\b/i.test(s) && !block.includes(s));
    const effects = spellConditions([block, ...repeat].join(' '), ability, duration);
    // A penalty die: "must subtract 1d4 from the attack roll or save" (Bane).
    const penalty = /subtract (\d+d\d+) from the attack roll(?: or (?:the )?(save|saving throw))?/i.exec(t);
    const rollModifier = penalty
      ? { dice: penalty[1]!, sign: -1 as const, attacks: true, saves: !!penalty[2], rounds: durationRounds(duration) ?? 10 }
      : undefined;
    if (damage.length === 0 && effects.length === 0 && !rollModifier) return skip('Saving throw effect not simulated');
    const area = /\beach creature\b/i.test(block.slice(0, 160)) ? parseArea(t) : undefined;
    const chosen = /^Up to (one|two|three|four|five|six|seven|eight|nine) creatures? of your choice/i.exec(t);
    note();
    return {
      kind: 'save',
      ability,
      damage,
      halfOnSave: /half as much|half the initial damage|takes half|half damage/i.test(block),
      ...(area ? { area } : {}),
      ...(!area && chosen ? { targets: NUMBER_WORDS[chosen[1]!.toLowerCase()]! } : {}),
      ...(rollModifier ? { rollModifier } : {}),
      ...(effects.length ? { effects } : {}),
      ...(scaling ? { scaling } : {}),
    };
  }

  // Healing spells.
  const heal = /regains? (?:a number of )?Hit Points equal to (\d+d\d+(?:\s*[+-]\s*\d+)?)(\s+plus (?:your|the caster's) spellcasting ability modifier)?/i.exec(t);
  if (heal) {
    note();
    return { kind: 'heal', dice: heal[1]!.replace(/\s+/g, ''), addsModifier: !!heal[2], ...(scaling ? { scaling } : {}) };
  }
  const flat = /(?:regains?|restor(?:es|ing)) (\d+) Hit Points/i.exec(t);
  if (flat) {
    note();
    return { kind: 'heal', dice: flat[1]!, addsModifier: false, ...(scaling ? { scaling } : {}) };
  }

  return undefined;
}

/**
 * Summons and walls create something that acts or lasts on its own, and smites ride on a weapon
 * attack: none of these are modelled.
 */
export const excludedByName = (name: string): boolean => /^(?:Conjure|Summon|Animate|Find|Create|Simulacrum)\b|\b(?:Wall|Barrier|Smite)\b/.test(name);
export const EXCLUDED_BY_NAME_NOTE = 'Summon, wall, barrier or smite: not simulated';

export interface ParsedSpell {
  def: SpellDef;
  problems: string[];
}

export function parseSpellBlock(lines: readonly string[]): ParsedSpell {
  const problems: string[] = [];
  const name = /^#### (.+?)\s*$/.exec(lines[0]!)![1]!;
  const body = lines.slice(1);
  const nonEmpty = body.filter((l) => l.trim() !== '');

  const header = /^_(?:Level (\d) ([A-Za-z]+)|([A-Za-z]+) Cantrip)\s*\(([^)]*)\)_\s*$/.exec(nonEmpty[0] ?? '');
  if (!header) problems.push(`unreadable header: ${nonEmpty[0]}`);
  const level = header?.[1] ? +header[1] : 0;
  const school = header?.[2] ?? header?.[3] ?? '';
  const classes = (header?.[4] ?? '').split(',').map((c) => c.trim()).filter(Boolean);

  // The source writes "**Component:**" instead of "**Components:**" for some spells.
  const field = (label: string): string => {
    const re = new RegExp(`^\\*\\*${label}s?:\\*\\*`); // label is singular: "Component" matches both spellings
    const line = nonEmpty.find((l) => re.test(l));
    if (!line) problems.push(`missing ${label}`);
    return line ? plain(line.replace(re, '')) : '';
  };
  const castingTime = field('Casting Time');
  const range = field('Range');
  const components = field('Component');
  const duration = field('Duration');

  // Paragraphs after the Duration line; the scaling paragraphs are kept apart.
  const durationAt = body.findIndex((l) => l.startsWith('**Duration:**'));
  const paragraphs = body.slice(durationAt + 1).join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const higherP = paragraphs.find((p) => /^_Using a Higher-Level Spell Slot\._/.test(p));
  const cantripP = paragraphs.find((p) => /^_Cantrip Upgrade\._/.test(p));
  const text = plain(paragraphs.filter((p) => p !== higherP && p !== cantripP).join(' '));
  const higher = higherP ? plain(higherP.replace(/^_Using a Higher-Level Spell Slot\._/, '')) : undefined;
  const cantripUpgrade = cantripP ? plain(cantripP.replace(/^_Cantrip Upgrade\._/, '')) : undefined;

  const concentration = /Concentration/i.test(duration);
  const notes: string[] = [];
  const scaling = parseScaling(higher, cantripUpgrade, notes);
  const effect = excludedByName(name)
    ? (notes.push(EXCLUDED_BY_NAME_NOTE), undefined)
    : parseEffect(text, castingTime, duration, concentration, scaling, notes);

  const def: SpellDef = {
    id: slugify(name),
    name,
    level,
    school,
    classes,
    castingTime,
    range,
    components,
    duration,
    concentration,
    ritual: /Ritual/i.test(castingTime),
    text,
    ...(higher ? { higher } : {}),
    ...(cantripUpgrade ? { cantripUpgrade } : {}),
    ...(effect ? { effect } : {}),
    notes,
  };

  // Consistency: a cantrip's header has no level; a leveled spell must have a school.
  if (header && !school) problems.push('no school');
  if (effect && (effect.kind === 'attack' || effect.kind === 'save') && effect.damage.length === 0 && !effect.effects?.length && !(effect.kind === 'save' && effect.rollModifier)) problems.push('effect with no damage, conditions or roll penalty');
  return { def, problems };
}
