import {
  isDamageType,
  type Ability,
  type AttackOption,
  type DamageComponent,
  type DamageType,
  type SaveOption,
} from '../engine/types';
import type { MonsterAction, MonsterDef, MonsterFeature, MultiattackPart } from './monsterTypes';

// Text parsers for the SRD stat block wording ("Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2)
// Slashing damage ..."). They work on plain text with the markdown already removed.

const ABILITY_BY_NAME: Record<string, Ability> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

/** Normalize typographic characters so the regexes only deal with ASCII punctuation. */
export function clean(text: string): string {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits "Fire Breath (Recharge 5-6)" into the name and its usage limit. */
export function splitLimit(name: string): { base: string; limit?: string } {
  const m = /^(.*?)\s*\(([^)]*)\)$/.exec(name);
  if (m && /recharge|\/day|rest/i.test(m[2]!)) return { base: m[1]!.trim(), limit: clean(m[2]!) };
  return { base: name };
}

const DAMAGE_RE = /(\d+)(?:\s*\(\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\))?\s+([A-Za-z]+)\s+damage/g;

/**
 * Damage components from the start of `text` onward: the first "N (dice) Type damage", then any
 * chained with "plus" / "and". Stops at "or" (versatile alternatives) and skips conditional
 * extras ("... if the attack roll had Advantage").
 */
export function parseDamage(text: string): DamageComponent[] {
  const t = clean(text);
  const parts: DamageComponent[] = [];
  let lastEnd = -1;
  DAMAGE_RE.lastIndex = 0;
  for (let m = DAMAGE_RE.exec(t); m; m = DAMAGE_RE.exec(t)) {
    const type = m[3]!.toLowerCase();
    if (lastEnd >= 0 && !/^\s*,?\s*(plus|and)\s*$/i.test(t.slice(lastEnd, m.index))) break;
    lastEnd = m.index + m[0].length;
    if (!isDamageType(type)) break;
    if (/^\s*,?\s*(if|when)\b/i.test(t.slice(lastEnd))) continue;
    parts.push({ dice: (m[2] ?? m[1]!).replace(/\s+/g, ''), type: type as DamageType });
  }
  return parts;
}

export function parseAttack(name: string, text: string): AttackOption | null {
  const t = clean(text);
  const roll = /(?:Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+-]\d+)/.exec(t);
  const hit = /\bHit:\s*(.*)$/.exec(t);
  if (!roll || !hit) return null;
  const damage = parseDamage(hit[1]!);
  if (damage.length === 0) return null;
  return { name, toHit: parseInt(roll[1]!, 10), damage };
}

export function parseSave(name: string, text: string): { save: SaveOption; area: boolean } | null {
  const t = clean(text);
  const head = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)/.exec(t);
  const failure = /Failure:\s*(.*?)(?:\s+(?:Failure or )?Success:|$)/.exec(t);
  if (!head || !failure) return null;
  const damage = parseDamage(failure[1]!);
  if (damage.length === 0) return null;
  const beforeFailure = t.slice(0, t.indexOf('Failure:'));
  return {
    save: {
      name,
      ability: ABILITY_BY_NAME[head[1]!.toLowerCase()]!,
      dc: parseInt(head[2]!, 10),
      damage,
      halfOnSave: /Success:\s*Half damage/i.test(t),
    },
    area: /each creature|\b(?:Cone|Line|Cube|Sphere|Emanation|Cylinder)\b/i.test(beforeFailure),
  };
}

/**
 * "The owlbear makes two Rend attacks." / "makes two Claw attacks and one Bite attack" /
 * "makes two attacks, using Greatsword or Heavy Crossbow in any combination" or "two Greatsword
 * or Heavy Crossbow attacks" (one part, with `options` listing the choices).
 */
export function parseMultiattack(text: string): MultiattackPart[] {
  const t = clean(text).split(/\.\s/)[0]!; // first sentence only: later ones are optional swaps

  const splitOptions = (s: string): string[] =>
    s
      .split(/\s*,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+/)
      .map((o) => o.trim())
      .filter(Boolean);

  const any = /\bmakes (one|two|three|four|five|six|seven|eight) attacks?,? using (.+?) in any combination/i.exec(t);
  if (any) {
    const options = splitOptions(any[2]!);
    return [{ action: options[0]!, count: NUMBER_WORDS[any[1]!.toLowerCase()]!, options }];
  }

  const parts: MultiattackPart[] = [];
  const re = /\b(one|two|three|four|five|six|seven|eight|an?)\s+([A-Z][A-Za-z' -]*?)\s+attacks?\b/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const names = splitOptions(m[2]!.trim());
    const count = NUMBER_WORDS[m[1]!.toLowerCase()]!;
    parts.push(names.length > 1 ? { action: names[0]!, count, options: names } : { action: names[0]!, count });
  }
  return parts;
}

/** Pull plain damage types out of a resistance/immunity list; report entries with conditions. */
export function damageTypes(entries: readonly string[], label: string, notes: string[]): DamageType[] {
  const out = new Set<DamageType>();
  for (const entry of entries) {
    const tokens = clean(entry).toLowerCase().split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean);
    if (tokens.length > 0 && tokens.every(isDamageType)) {
      for (const t of tokens) out.add(t as DamageType);
    } else {
      // Qualified entries such as "Bludgeoning, Piercing, Slashing (from nonmagical attacks)".
      notes.push(`${label} not applied: ${entry}`);
    }
  }
  return [...out];
}

/**
 * Sort a monster's action entries into simulated actions, the multiattack, and everything else
 * (spellcasting, grapples, effect-only saves, ...).
 */
export function classifyActions(
  entries: readonly MonsterFeature[],
  notes: string[],
): Pick<MonsterDef, 'actions' | 'multiattack' | 'otherActions'> {
  const actions: MonsterAction[] = [];
  const otherActions: MonsterFeature[] = [];
  let multiattack: MonsterDef['multiattack'];

  for (const entry of entries) {
    const f = { ...entry };

    // Shapechangers: "Bite (Bear or Hybrid Form Only)". Keep the base name; note the restriction.
    const form = /^(.*?)\s*\(([^)]*\bOnly)\)$/.exec(f.name);
    if (form) {
      f.name = form[1]!.trim();
      notes.push(`${f.name} is only usable in some forms (${form[2]}); the simulator allows it at all times`);
    }
    const { base, limit } = splitLimit(f.name);

    if (base === 'Multiattack') {
      multiattack = { text: f.text, parts: parseMultiattack(f.text) };
      continue;
    }

    const attack = parseAttack(base, f.text);
    if (attack) {
      actions.push({ kind: 'attack', name: base, attack, ...(limit ? { limit } : {}) });
      continue;
    }

    const save = parseSave(base, f.text);
    if (save) {
      actions.push({
        kind: 'save',
        name: base,
        save: save.save,
        ...(save.area ? { area: true } : {}),
        ...(limit ? { limit } : {}),
      });
      continue;
    }

    otherActions.push(f);
  }

  return { actions, ...(multiattack ? { multiattack } : {}), otherActions };
}

/**
 * Consistency check on printed damage: in "13 (1d10 + 8)" the number is the rounded-down average
 * of the dice. Returns a message for every component where they disagree.
 */
export function damageAverageProblems(text: string): string[] {
  const out: string[] = [];
  const t = clean(text);
  DAMAGE_RE.lastIndex = 0;
  for (let m = DAMAGE_RE.exec(t); m; m = DAMAGE_RE.exec(t)) {
    if (!m[2]) continue;
    const d = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(m[2]);
    if (!d) continue;
    const avg = (+d[1]! * (+d[2]! + 1)) / 2 + (d[3] ? (d[3] === '-' ? -1 : 1) * +d[4]! : 0);
    if (Math.floor(avg) !== +m[1]!) out.push(`${m[1]} (${m[2]}) should average ${Math.floor(avg)}`);
  }
  return out;
}
