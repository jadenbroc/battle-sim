import { describe, expect, it } from 'vitest';
import { clericSheet, clericSpells, spellPage, toFields } from './fixtures';
import { missingRequired, parseCharacterSheet, parseClasses, parseSheetDamage, parseSigned } from './parseCharacterSheet';
import { normalizeFieldName, readPdfFields, type PdfJsLike } from './pdfFields';

const parse = (values = clericSheet(), extra: ReturnType<typeof toFields> = []) => parseCharacterSheet([...toFields(values), ...extra]);

describe('small parsers', () => {
  it('parseSigned reads signed numbers and rejects other text', () => {
    expect(parseSigned('+5')).toBe(5);
    expect(parseSigned('-1')).toBe(-1);
    expect(parseSigned('−2')).toBe(-2);
    expect(parseSigned(' 14 ')).toBe(14);
    for (const t of ['', '--', 'WIS 14', undefined]) expect(parseSigned(t as string)).toBeUndefined();
  });

  it('parseSheetDamage reads dice, flat damage and several types', () => {
    expect(parseSheetDamage('1d6+4 Bludgeoning')).toEqual([{ dice: '1d6+4', type: 'bludgeoning' }]);
    expect(parseSheetDamage('1d6-1 Bludgeoning')).toEqual([{ dice: '1d6-1', type: 'bludgeoning' }]);
    expect(parseSheetDamage('5 Bludgeoning')).toEqual([{ dice: '5', type: 'bludgeoning' }]);
    expect(parseSheetDamage('1d8+3 Slashing + 1d6 Fire')).toEqual([
      { dice: '1d8+3', type: 'slashing' },
      { dice: '1d6', type: 'fire' },
    ]);
    expect(parseSheetDamage('')).toEqual([]);
  });

  it('parseClasses reads single and multiclass levels', () => {
    expect(parseClasses('Cleric 4')).toEqual([{ name: 'Cleric', level: 4 }]);
    expect(parseClasses('Cleric 1 / Wizard 3')).toEqual([
      { name: 'Cleric', level: 1 },
      { name: 'Wizard', level: 3 },
    ]);
    expect(parseClasses('')).toEqual([]);
  });

  it('normalizes stray spaces in field names', () => {
    expect(normalizeFieldName('Wpn2 AtkBonus ')).toBe('Wpn2 AtkBonus');
    expect(normalizeFieldName('CLASS  LEVEL')).toBe('CLASS LEVEL');
  });
});

describe('the character sheet', () => {
  const { character: c, readable } = parse();

  it('reads who the character is', () => {
    expect(readable).toBe(true);
    expect(c).toMatchObject({ id: 'test-cleric', name: 'Test Cleric', species: 'Half-Elf', background: 'Noble', classes: [{ name: 'Cleric', level: 4 }], hitDice: '4d8', speed: '30 ft. (Walking)', size: 'medium' });
  });

  it('reads the numbers', () => {
    expect(c.abilityScores).toEqual({ str: 8, dex: 10, con: 14, int: 12, wis: 18, cha: 16 });
    expect(c).toMatchObject({ ac: 13, maxHp: 31, proficiencyBonus: 2, initiativeBonus: 0 });
  });

  it('keeps only the saving throws that differ from the ability modifier', () => {
    expect(c.saveBonuses).toEqual({ wis: 6, cha: 5 });
  });

  it('works out the initiative bonus beyond Dexterity', () => {
    const alert = parse(clericSheet({ Init: '+5', DEX: '14' })).character;
    expect(alert.initiativeBonus).toBe(3);
  });

  it('is fully confident about fields it read, and warns about non-damage immunities', () => {
    expect(Object.values(c.confidence).every((v) => v === 'high')).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/Immunities not applied \(not a damage type\): magical sleep/);
  });

  it('reads damage resistances, vulnerabilities and immunities, and condition immunities', () => {
    const d = parse(clericSheet({ Defenses: 'Resistances - Necrotic, Fire\nVulnerabilities - Radiant\nImmunities - Poison, Charmed' })).character;
    expect(d).toMatchObject({ resistances: ['necrotic', 'fire'], vulnerabilities: ['radiant'], immunities: ['poison'], conditionImmunities: ['charmed'] });
  });

  it('flags missing required fields', () => {
    const bad = parse(clericSheet({ AC: '', MaxHP: '', 'CLASS LEVEL': '', STR: '' })).character;
    expect(bad.confidence).toMatchObject({ ac: 'missing', maxHp: 'missing', classes: 'missing', 'ability.str': 'missing' });
    expect(missingRequired(bad)).toEqual(expect.arrayContaining(['class and level', 'str score', 'armor class', 'max HP']));
  });

  it('assumes a medium size, with a warning, when the sheet has none', () => {
    const r = parse(clericSheet({ SIZE: '' })).character;
    expect(r.size).toBe('medium');
    expect(r.confidence.size).toBe('low');
  });

  it('says a PDF with no form fields is unreadable', () => {
    const r = parseCharacterSheet([]);
    expect(r.readable).toBe(false);
    expect(r.character.warnings.join(' ')).toMatch(/no D&D Beyond character sheet form fields/);
  });
});

describe('the attacks table', () => {
  it('reads weapon rows and skips rows that are no use in a fight', () => {
    const { character } = parse();
    expect(character.attacks).toEqual([
      { name: 'Mace', toHit: 1, damage: [{ dice: '1d6-1', type: 'bludgeoning' }], notes: 'Simple, Sap', range: 'melee', weapon: true },
    ]); // the 0-damage unarmed strike is left out
  });

  it('keeps an unarmed strike that does damage, and skips feature reminder rows with none', () => {
    const { character } = parse(
      clericSheet({ 'Wpn2 Damage': '5 Bludgeoning', 'Wpn Name 3': 'Polearm Master - Opportunity Attack', 'Wpn3 AtkBonus': '', 'Wpn3 Damage': '' }),
    );
    expect(character.attacks.map((a) => [a.name, a.damage[0]!.dice])).toEqual([
      ['Mace', '1d6-1'],
      ['Unarmed Strike', '5'],
    ]);
  });

  it('treats a row with component notes as a spell, and guesses ranged weapons', () => {
    const { character } = parse(
      clericSheet({
        'Wpn Name 3': 'Fire Bolt',
        'Wpn3 AtkBonus': '+5',
        'Wpn3 Damage': '1d10 Fire',
        'Wpn Notes 3': 'V/S',
        'Wpn Name 4': 'Longbow',
        'Wpn4 AtkBonus': '+4',
        'Wpn4 Damage': '1d8+2 Piercing',
        'Wpn Notes 4': 'Martial, Ammunition',
      }),
    );
    const byName = Object.fromEntries(character.attacks.map((a) => [a.name, a]));
    expect(byName['Fire Bolt']).toMatchObject({ weapon: false });
    expect(byName.Longbow).toMatchObject({ weapon: true, range: 'ranged' });
  });

  it('leaves a blank attack bonus as NaN so it can be filled in from the spell list', () => {
    const { character } = parse(clericSheet({ 'Wpn Name 3': 'Shocking Grasp', 'Wpn3 AtkBonus': '', 'Wpn3 Damage': '1d8 Lightning', 'Wpn Notes 3': 'V/S' }));
    expect(Number.isNaN(character.attacks.find((a) => a.name === 'Shocking Grasp')!.toHit)).toBe(true);
  });
});

describe('Extra Attack', () => {
  const extra = (cls: string) => parse(clericSheet({ 'CLASS LEVEL': cls, FeaturesTraits2: '* Extra Attack • PHB 72\nYou can attack twice.' })).character;

  it('gives 2 attacks, 3 for a level 11 Fighter and 4 for level 20, and flags it as a guess', () => {
    expect(extra('Paladin 5').attacksPerAction).toBe(2);
    expect(extra('Fighter 5').attacksPerAction).toBe(2);
    expect(extra('Fighter 11').attacksPerAction).toBe(3);
    expect(extra('Fighter 20').attacksPerAction).toBe(4);
    expect(extra('Fighter 5').confidence.attacksPerAction).toBe('low');
  });

  it('is 1 without the feature', () => {
    expect(parse().character.attacksPerAction).toBe(1);
  });
});

describe('the spell pages', () => {
  const { character: c } = parse(clericSheet(), clericSpells());
  const byName = (n: string) => c.spells.find((s) => s.name === n)!;

  it('gives each spell the level of the section header above it', () => {
    expect(byName('Sacred Flame').level).toBe(0);
    expect(byName('Healing Word').level).toBe(1);
    expect(byName('Guiding Bolt').level).toBe(2);
  });

  it('reads the spell slots from the headers', () => {
    expect(c.slots).toEqual({ 1: 4, 2: 3 }); // cantrips are "(At Will)" and have no slots
  });

  it('merges the 2014 and 2024 versions of a spell, preferring 2024', () => {
    expect(c.spells.filter((s) => s.name === 'Inflict Wounds')).toHaveLength(1);
    expect(byName('Inflict Wounds').page).toBe('PHB-2024 288');
    expect(byName('Inflict Wounds').save).toEqual({ ability: 'con', dc: 14 });
    expect(byName('Inflict Wounds').attackBonus).toBeUndefined();
    expect(byName('Healing Word').page).toBe('PHB-2024 284');
    expect(c.warnings.join(' ')).toMatch(/2 duplicate spell entries/);
  });

  it('reads each spell\'s own save DC, attack bonus, casting time and always-prepared flag', () => {
    expect(byName('Sacred Flame').save).toEqual({ ability: 'dex', dc: 14 });
    expect(byName('Guiding Bolt').attackBonus).toBe(6);
    expect(byName('Guidance')).toMatchObject({ castingTime: '1A' });
    expect(byName('Guidance').save).toBeUndefined();
    expect(byName('Healing Word').castingTime).toBe('1BA');
    expect(byName('Bless')).toMatchObject({ alwaysPrepared: true, source: 'Cleric (Always Prepared)' });
    expect(byName('Healing Word').alwaysPrepared).toBe(false);
  });

  it('strips the ritual tag and records it', () => {
    expect(byName('Detect Magic')).toMatchObject({ ritual: true, castingTime: '1A + 10m' });
  });

  it('reads the casting class, ability, DC and attack bonus', () => {
    expect(c.spellcasting).toEqual([{ name: 'Cleric', ability: 'wis', saveDC: 14, attackBonus: 6 }]);
  });

  it('continues the last section across pages, and reads multiclass casting', () => {
    const page1 = spellPage(
      { cls: 'Cleric / Wizard', ability: 'WIS / INT', dc: '12 / 14', atk: '+4 / +6' },
      [
        { header: '=== CANTRIPS ===', slots: '(At Will)', spells: [{ name: 'Mind Sliver', source: 'Wizard', hit: 'INT 14' }] },
        { header: '=== 1st LEVEL ===', slots: '4 Slots OOOO', spells: [{ name: 'Magic Missile', source: 'Wizard' }] },
        { header: '=== 2nd LEVEL ===', slots: '3 Slots OOO', spells: [{ name: 'Shatter', source: 'Wizard', hit: 'CON 14' }] },
      ],
      { pageNo: 2 },
    );
    const page2 = spellPage({ cls: 'Cleric / Wizard', ability: 'WIS / INT', dc: '12 / 14', atk: '+4 / +6' }, [{ header: '', slots: '', spells: [{ name: 'Levitate', source: 'Wizard', hit: 'CON 14' }] }], {
      pageNo: 3,
      startIndex: 3,
      headerStart: 9,
    });
    const multi = parseCharacterSheet([...toFields(clericSheet({ 'CLASS LEVEL': 'Cleric 1 / Wizard 3' })), ...page1, ...page2]).character;
    expect(multi.classes).toEqual([
      { name: 'Cleric', level: 1 },
      { name: 'Wizard', level: 3 },
    ]);
    expect(multi.spellcasting).toEqual([
      { name: 'Cleric', ability: 'wis', saveDC: 12, attackBonus: 4 },
      { name: 'Wizard', ability: 'int', saveDC: 14, attackBonus: 6 },
    ]);
    expect(multi.spells.find((s) => s.name === 'Levitate')!.level).toBe(2); // no header on page 3: the last one above applies
    expect(multi.slots).toEqual({ 1: 4, 2: 3 });
  });

  it('warns when a sheet lists leveled spells but no slots', () => {
    const noSlots = spellPage({ cls: 'Cleric', ability: 'WIS', dc: '14', atk: '+6' }, [{ header: '=== 1st LEVEL ===', slots: '', spells: [{ name: 'Bless' }] }]);
    const r = parseCharacterSheet([...toFields(clericSheet()), ...noSlots]).character;
    expect(r.confidence.slots).toBe('missing');
    expect(r.warnings.join(' ')).toMatch(/slots not found/i);
  });
});

describe('readPdfFields', () => {
  const fake = (annotations: unknown[][]): PdfJsLike => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: annotations.length,
        getPage: async (n: number) => ({ getAnnotations: async () => annotations[n - 1] as never }),
      }),
    }),
  });

  it('reads text fields with their page and position, and ignores other widgets', async () => {
    const fields = await readPdfFields(
      new Uint8Array(),
      fake([
        [
          { subtype: 'Widget', fieldType: 'Tx', fieldName: 'CharacterName', fieldValue: 'Test', rect: [10, 20, 50, 30] },
          { subtype: 'Widget', fieldType: 'Btn', fieldName: 'Check Box 1', fieldValue: 'Off', rect: [0, 0, 1, 1] },
          { subtype: 'Link', rect: [0, 0, 1, 1] },
        ],
        [{ subtype: 'Widget', fieldType: 'Tx', fieldName: 'Wpn2 AtkBonus ', fieldValue: ['+5'], rect: [5, 6, 7, 8] }],
      ]),
    );
    expect(fields).toEqual([
      { name: 'CharacterName', value: 'Test', page: 1, x: 10, y: 20 },
      { name: 'Wpn2 AtkBonus', value: '+5', page: 2, x: 5, y: 6 },
    ]);
  });
});
