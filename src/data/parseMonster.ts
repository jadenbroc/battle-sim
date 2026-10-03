import {
  isDamageType,
  type Ability,
  type AttackOption,
  type ConditionEffect,
  type ConditionName,
  type DamageComponent,
  type DamageType,
  type Duration,
  type SaveOption,
  type Size,
  type UseLimit,
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

/**
 * "Recharge 5-6" -> recharge on 5 or 6. "Recharge 6" -> on 6. "3/Day" -> 3 uses.
 * "Recharges after a Short or Long Rest" -> 1 use (a fight has no rests). Anything else is
 * not understood and returns undefined.
 */
export function parseUseLimit(text: string): UseLimit | undefined {
  const t = clean(text);
  const recharge = /^Recharge (\d)(?:-\d)?$/i.exec(t);
  if (recharge) return { kind: 'recharge', min: +recharge[1]! };
  const perDay = /^(\d+)\/Day$/i.exec(t);
  if (perDay) return { kind: 'perDay', uses: +perDay[1]! };
  if (/^Recharges? after a Short or Long Rest$/i.test(t)) return { kind: 'perDay', uses: 1 };
  return undefined;
}

const COND_NAMES = 'Blinded|Charmed|Deafened|Frightened|Grappled|Incapacitated|Invisible|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious';

/**
 * The condition an action needs its target to already have ("one creature within 5 feet that has
 * the Prone condition", "one creature Grappled by the behir"), or null.
 */
export function requiredTargetCondition(text: string): ConditionName | null {
  const t = clean(text);
  // Parentheticals are optional extras ("+5 (with Advantage if the target is Grappled by ...)").
  const before = t.split(/\b(?:Failure|Hit):/)[0]!.replace(/\([^)]*\)/g, ' ');
  const has = new RegExp(`\\b(?:has|have) the (${COND_NAMES}) condition`, 'i').exec(before);
  if (has) return has[1]!.toLowerCase() as ConditionName;
  if (/\bGrappled by\b/i.test(before)) return 'grappled';
  return null;
}

const COND_RE = new RegExp(`\\b(?:has|have|is|are|becomes?|gains?|gained)\\s+(?:the\\s+)?(${COND_NAMES})(?:\\s+and\\s+(${COND_NAMES}))?(?:\\s+conditions?)?`, 'gi');

function parseDuration(tail: string, save: SaveContext | undefined): { duration: Duration; repeatSave?: SaveContext; escapeDc?: number } {
  const escape = /\(escape DC (\d+)\)/i.exec(tail);
  const repeats = /\brepeats? the (?:save|saving throw)\b/i.test(tail) && save ? { repeatSave: save } : {};
  const extra = { ...repeats, ...(escape ? { escapeDc: +escape[1]! } : {}) };

  if (/until the grapple ends/i.test(tail)) return { duration: { kind: 'while', condition: 'grappled' }, ...extra };

  const turn = /until the (start|end) of (?:its|(?:the )?([\w' -]+?)'s?) next turn/i.exec(tail);
  if (turn) {
    const source = turn[2];
    if (!source) return { duration: { kind: 'endOfTargetNextTurn' }, ...extra };
    return { duration: { kind: turn[1]!.toLowerCase() === 'start' ? 'startOfSourceNextTurn' : 'endOfSourceNextTurn' }, ...extra };
  }

  const span = /for (\d+) (minute|hour)s?/i.exec(tail);
  if (span) return { duration: { kind: 'rounds', n: +span[1]! * (span[2]!.toLowerCase() === 'minute' ? 10 : 600) }, ...extra };
  return { duration: { kind: 'indefinite' }, ...extra };
}

export interface SaveContext {
  ability: Ability;
  dc: number;
}

/**
 * Conditions inflicted by an attack's hit or a save's failure, read from the effect text:
 * "it has the Grappled condition (escape DC 14)", "the target has the Prone condition", "...until the
 * end of its next turn", "for 1 minute", "repeats the save at the end of each of its turns".
 * `save` is the save a "repeats the save" clause refers to. Staged effects ("First Failure",
 * "Failure by 5 or More"), things that happen while swallowed or possessed, and HP-dependent
 * outcomes are not read.
 */
export function parseConditionEffects(text: string, save?: SaveContext): ConditionEffect[] {
  let t = clean(text);
  if (/First Failure|Second Failure/i.test(t)) return [];
  t = t.split(/\bFailure by \d+ or More\b/i)[0]!;

  const out: ConditionEffect[] = [];
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z(])/);
  for (const sentence of sentences) {
    // "While Poisoned, the target has the Paralyzed condition": lasts as long as the first one.
    const linked = new RegExp(`^While (${COND_NAMES}), the target has the (${COND_NAMES}) condition`, 'i').exec(sentence);
    if (linked) {
      const anchor = linked[1]!.toLowerCase() as ConditionName;
      const condition = linked[2]!.toLowerCase() as ConditionName;
      if (out.some((e) => e.condition === anchor) && !out.some((e) => e.condition === condition)) {
        out.push({ condition, duration: { kind: 'while', condition: anchor } });
      }
      continue;
    }
    if (/^While\b/i.test(sentence) || /swallow|possess|Total Cover|no longer|Hit Points or fewer|dies|second save/i.test(sentence)) continue;
    if (!/\b(?:target|it|creature)\b/i.test(sentence)) continue;

    const size = /\bis (?:an? )?(Tiny|Small|Medium|Large|Huge|Gargantuan)(?: or smaller)?(?: creature)?/i.exec(sentence)?.[1];
    const matches = [...sentence.matchAll(COND_RE)];
    matches.forEach((m, i) => {
      const end = m.index + m[0].length;
      const next = matches[i + 1]?.index ?? sentence.length;
      const tail = sentence.slice(end, next);
      const { duration, repeatSave, escapeDc } = parseDuration(tail, save);
      for (const raw of [m[1], m[2]]) {
        if (!raw) continue;
        const condition = raw.toLowerCase() as ConditionName;
        if (out.some((e) => e.condition === condition)) continue;
        out.push({
          condition,
          duration,
          ...(size ? { maxSize: size.toLowerCase() as Size } : {}),
          ...(repeatSave ? { repeatSave } : {}),
          ...(escapeDc && condition === 'grappled' ? { escapeDc } : {}),
        });
      }
    });
  }

  // "...have the Paralyzed condition. At the end of each of its turns, the target repeats the save":
  // the repeat is in a later sentence. With a single condition it clearly belongs to it.
  const [only] = out;
  if (out.length === 1 && only && !only.repeatSave && save && /\b(?:the target|it) repeats? the (?:save|saving throw)\b/i.test(t)) {
    only.repeatSave = save;
  }
  return out;
}

const DAMAGE_RE =/(\d+)(?:\s*\(\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\))?\s+([A-Za-z]+)\s+damage/g;

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

const SAVE_RE = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)/;

export function parseAttack(name: string, text: string): AttackOption | null {
  const t = clean(text);
  const roll = /(Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+-]\d+)/.exec(t);
  const hit = /\bHit:\s*(.*)$/.exec(t);
  if (!roll || !hit) return null;

  // A rider may allow a save to avoid it: "...subjected to the following effect. Constitution
  // Saving Throw: DC 12. Failure: The target has the Poisoned condition ...".
  const [plainText, nested] = splitAtSave(hit[1]!);
  const effects = [
    ...parseConditionEffects(plainText),
    ...(nested ? parseConditionEffects(nested.failure, nested.save).map((e) => ({ ...e, avoidSave: nested.save })) : []),
  ];

  const damage = parseDamage(plainText);
  if (damage.length === 0 && effects.length === 0) return null;
  return {
    name,
    toHit: parseInt(roll[2]!, 10),
    damage,
    ...(roll[1] === 'Ranged' ? { range: 'ranged' as const } : {}),
    ...(effects.length ? { effects } : {}),
  };
}

function splitAtSave(text: string): [string, { save: SaveContext; failure: string } | null] {
  const m = SAVE_RE.exec(text);
  if (!m) return [text, null];
  const failure = /Failure:\s*(.*?)(?:\s+(?:Failure or )?Success:|$)/.exec(text.slice(m.index));
  if (!failure) return [text, null];
  return [text.slice(0, m.index), { save: { ability: ABILITY_BY_NAME[m[1]!.toLowerCase()]!, dc: +m[2]! }, failure: failure[1]! }];
}

export function parseSave(name: string, text: string): { save: SaveOption; area: boolean } | null {
  const t = clean(text);
  const head = SAVE_RE.exec(t);
  const failure = /Failure:\s*(.*?)(?:\s+(?:Failure or )?Success:|$)/.exec(t);
  if (!head || !failure) return null;
  const ability = ABILITY_BY_NAME[head[1]!.toLowerCase()]!;
  const dc = parseInt(head[2]!, 10);
  const damage = parseDamage(failure[1]!);
  const effects = parseConditionEffects(failure[1]!, { ability, dc });
  if (damage.length === 0 && effects.length === 0) return null;
  const beforeFailure = t.slice(0, t.indexOf('Failure:'));
  return {
    save: {
      name,
      ability,
      dc,
      damage,
      halfOnSave: /Success:\s*Half damage/i.test(t),
      ...(effects.length ? { effects } : {}),
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
  opts: { bonus?: boolean } = {},
): Pick<MonsterDef, 'actions' | 'multiattack' | 'otherActions'> {
  const slot = opts.bonus ? { bonus: true as const } : {};
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
    const { base, limit: limitText } = splitLimit(f.name);

    if (base === 'Multiattack' && !opts.bonus) {
      multiattack = { text: f.text, parts: parseMultiattack(f.text) };
      continue;
    }

    // A usage limit we do not understand: leave the action unsimulated.
    const limit = limitText ? parseUseLimit(limitText) : undefined;
    if (limitText && !limit) {
      otherActions.push(f);
      continue;
    }
    // Swallowing, engulfing and possession change a creature's whole state (damage each turn,
    // total cover, ...), which is not modelled: leave them unsimulated.
    // (An ordinary attack roll that merely mentions a swallowed corpse is still an attack.)
    const isAttackRoll = /Attack Roll:\s*[+-]\d+/.test(f.text);
    if ((/swallow|engulf|possess/i.test(f.text) && !isAttackRoll) || base === 'Attach') {
      otherActions.push(f);
      continue;
    }

    const requires = requiredTargetCondition(f.text);
    const extra = { ...(limit ? { limit } : {}), ...slot, ...(requires ? { targetRequires: requires } : {}) };
    // Condition words left once the "needs a target that has X" requirement is set aside.
    const mentionsConditions = /\bcondition\b/i.test(f.text.replace(/that (?:has|is) the \w+ condition/i, ''));

    const attack = parseAttack(base, f.text);
    if (attack) {
      actions.push({ kind: 'attack', name: base, attack, ...extra });
      if (mentionsConditions && !attack.effects) notes.push(`${base}: condition effects are not simulated`);
      continue;
    }

    const save = parseSave(base, f.text);
    if (save) {
      actions.push({ kind: 'save', name: base, save: save.save, ...(save.area ? { area: true } : {}), ...extra });
      if (mentionsConditions && !save.save.effects) notes.push(`${base}: condition effects are not simulated`);
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
