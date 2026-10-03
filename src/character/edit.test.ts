import { describe, expect, it } from 'vitest';
import { blankCharacter, classesToText, damageToText, markEdited, parseCharacterJson, parseConditionNames, parseDamageTypes, setAttackDamage, uniqueId, validateCharacter, MAX_PARTY } from './edit';
import { clericSheet, clericSpells, toFields } from './fixtures';
import { parseCharacterSheet } from './parseCharacterSheet';

const parsed = () => parseCharacterSheet([...toFields(clericSheet()), ...clericSpells()]).character;

describe('blankCharacter and ids', () => {
  it('makes a usable character with ordinary defaults', () => {
    const c = blankCharacter('Brave Sir Robin');
    expect(c).toMatchObject({ id: 'brave-sir-robin', name: 'Brave Sir Robin', ac: 10, maxHp: 10, size: 'medium', attacksPerAction: 1, profile: 'weakest' });
    expect(c.attacks).toHaveLength(1);
    expect(validateCharacter(JSON.parse(JSON.stringify(c))).ok).toBe(true);
  });

  it('numbers ids that are taken', () => {
    expect(uniqueId('Test Cleric', [])).toBe('test-cleric');
    expect(uniqueId('Test Cleric', ['test-cleric'])).toBe('test-cleric-2');
    expect(uniqueId('Test Cleric', ['test-cleric', 'test-cleric-2'])).toBe('test-cleric-3');
    expect(uniqueId('!!!', [])).toBe('character');
  });

  it('caps the party at 8', () => {
    expect(MAX_PARTY).toBe(8);
  });
});

describe('text helpers', () => {
  it('writes and reads classes and damage', () => {
    expect(classesToText({ classes: [{ name: 'Cleric', level: 1 }, { name: 'Wizard', level: 3 }] })).toBe('Cleric 1 / Wizard 3');
    expect(damageToText([{ dice: '1d8+3', type: 'slashing' }, { dice: '1d6', type: 'fire' }])).toBe('1d8+3 slashing + 1d6 fire');
  });

  it('setAttackDamage accepts damage text and rejects nonsense', () => {
    const a = { name: 'x', toHit: 1, damage: [{ dice: '1', type: 'fire' as const }], notes: '', range: 'melee' as const, weapon: true };
    expect(setAttackDamage(a, '2d6+1 Slashing + 1d4 Fire')).toBe(true);
    expect(a.damage).toEqual([
      { dice: '2d6+1', type: 'slashing' },
      { dice: '1d4', type: 'fire' },
    ]);
    expect(setAttackDamage(a, 'lots')).toBe(false);
    expect(a.damage).toHaveLength(2); // unchanged
  });

  it('parses lists of damage types and conditions, dropping unknown words', () => {
    expect(parseDamageTypes('Fire, cold; nonsense, fire')).toEqual(['fire', 'cold']);
    expect(parseConditionNames('Charmed, Frightened, bogus')).toEqual(['charmed', 'frightened']);
  });

  it('markEdited clears a flag without touching the others', () => {
    const c = blankCharacter();
    c.confidence = { ac: 'missing', maxHp: 'low' };
    markEdited(c, 'ac');
    expect(c.confidence).toEqual({ ac: 'high', maxHp: 'low' });
  });
});

describe('validateCharacter', () => {
  it('accepts a minimal character and fills in the rest', () => {
    const r = validateCharacter({ name: ' Ann ', classes: [{ name: 'Rogue', level: 3 }], abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 }, ac: 14, maxHp: 21 });
    expect(r.ok && r.character).toMatchObject({ name: 'Ann', id: 'ann', attacks: [], slots: {}, size: 'medium', profile: 'weakest', attacksPerAction: 1, initiativeBonus: 0 });
  });

  it('round-trips a parsed sheet through JSON', () => {
    const original = parsed();
    const r = validateCharacter(JSON.parse(JSON.stringify(original)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.character).toMatchObject({
      name: original.name,
      classes: original.classes,
      abilityScores: original.abilityScores,
      saveBonuses: original.saveBonuses,
      ac: original.ac,
      maxHp: original.maxHp,
      slots: original.slots,
      spellcasting: original.spellcasting,
      attacks: original.attacks,
    });
    expect(r.character.spells.map((s) => s.name)).toEqual(original.spells.map((s) => s.name));
    expect(r.character.spells.find((s) => s.name === 'Inflict Wounds')!.save).toEqual({ ability: 'con', dc: 14 });
  });

  const base = () => ({ name: 'A', classes: [{ name: 'Rogue', level: 1 }], abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ac: 10, maxHp: 10 });

  it.each([
    ['not an object', 5, /JSON object/],
    ['no name', { ...base(), name: '' }, /name/],
    ['bad classes', { ...base(), classes: [] }, /classes/],
    ['bad class level', { ...base(), classes: [{ name: 'Rogue', level: 0 }] }, /classes/],
    ['missing ability', { ...base(), abilityScores: { str: 10 } }, /abilityScores/],
    ['ac not a number', { ...base(), ac: 'ten' }, /ac/],
    ['no hit points', { ...base(), maxHp: 0 }, /maxHp/],
    ['attack without damage', { ...base(), attacks: [{ name: 'x', toHit: 1, damage: [] }] }, /attack/],
    ['bad damage type', { ...base(), attacks: [{ name: 'x', toHit: 1, damage: [{ dice: '1d4', type: 'sparkles' }] }] }, /invalid damage/],
  ])('rejects %s', (_label, value, message) => {
    const r = validateCharacter(value);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(message);
  });

  it('rejects an unreadable (null) number when importing hand-written JSON, but the saved party may hold one', () => {
    const incomplete = { ...base(), ac: null, maxHp: null, classes: [], abilityScores: { str: null, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
    expect(validateCharacter(incomplete).ok).toBe(false);
    const lenient = validateCharacter(incomplete, { lenient: true });
    expect(lenient.ok && lenient.character).toMatchObject({ ac: NaN, maxHp: NaN, classes: [] });
    expect(lenient.ok && lenient.character.abilityScores.str).toBeNaN();
    expect(validateCharacter({ ...base(), maxHp: -3 }, { lenient: true }).ok).toBe(false); // still no negative hit points
  });

  it('clamps attacks per action and ignores nonsense slots and sizes', () => {
    const r = validateCharacter({ ...base(), attacksPerAction: 9, slots: { 1: 4, 0: 3, x: 2, 2: -1 }, size: 'gigantic' });
    expect(r.ok && r.character).toMatchObject({ attacksPerAction: 4, slots: { 1: 4 }, size: 'medium' });
  });
});

describe('parseCharacterJson', () => {
  const one = { name: 'A', classes: [{ name: 'Rogue', level: 1 }], abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, ac: 10, maxHp: 10 };

  it('reads one character or a list', () => {
    expect(parseCharacterJson(JSON.stringify(one)).characters).toHaveLength(1);
    expect(parseCharacterJson(JSON.stringify([one, { ...one, name: 'B' }])).characters.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('keeps the good characters and reports the bad ones', () => {
    const r = parseCharacterJson(JSON.stringify([one, { ...one, ac: 'x' }]));
    expect(r.characters).toHaveLength(1);
    expect(r.errors).toEqual(['character 2: "ac" must be a number']);
  });

  it('reports invalid JSON', () => {
    expect(parseCharacterJson('{nope')).toEqual({ characters: [], errors: ['not valid JSON'] });
  });
});
