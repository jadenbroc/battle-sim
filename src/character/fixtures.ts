import type { PdfField } from './pdfFields';

// Synthetic sheets for tests. The field names are those of real D&D Beyond exports; the values are
// invented (no real names, no player names, no non-SRD text).

type Values = Record<string, string>;

export function toFields(values: Values, page = 1): PdfField[] {
  return Object.entries(values).map(([name, value], i) => ({ name, value, page, x: 0, y: 700 - i }));
}

/** A level 4 Cleric with a mace, as the main sheet page of an export. */
export function clericSheet(over: Values = {}): Values {
  return {
    CharacterName: 'Test Cleric',
    'CLASS LEVEL': 'Cleric 4',
    RACE: 'Half-Elf',
    BACKGROUND: 'Noble',
    STR: '8',
    STRmod: '-1',
    DEX: '10',
    CON: '14',
    INT: '12',
    WIS: '18',
    CHA: '16',
    'ST Strength': '-1',
    'ST Dexterity': '+0',
    'ST Constitution': '+2',
    'ST Intelligence': '+1',
    'ST Wisdom': '+6',
    'ST Charisma': '+5',
    ProfBonus: '+2',
    AC: '13',
    MaxHP: '31',
    Total: '4d8',
    Init: '+0',
    Speed: '30 ft. (Walking)',
    Defenses: 'Immunities - Magical Sleep',
    SIZE: 'Medium',
    'Wpn Name': 'Mace',
    'Wpn1 AtkBonus': '+1',
    'Wpn1 Damage': '1d6-1 Bludgeoning',
    'Wpn Notes 1': 'Simple, Sap',
    'Wpn Name 2': 'Unarmed Strike',
    'Wpn2 AtkBonus': '+1',
    'Wpn2 Damage': '0 Bludgeoning',
    'Wpn Notes 2': '',
    FeaturesTraits1: '=== CLERIC FEATURES ===\n* Spellcasting\n* Channel Divinity',
    ...over,
  };
}

interface SpellRowInput {
  name: string;
  source?: string;
  hit?: string;
  time?: string;
  prepared?: string;
  page?: string;
}

/**
 * Spell page fields. `sections` is a list of [header text, slot text, spells]; sections are laid out
 * top to bottom on `pageNo`, and rows continue on later pages when `pageBreak` rows have been placed.
 */
export function spellPage(
  casting: { cls: string; ability: string; dc: string; atk: string },
  sections: { header: string; slots: string; spells: SpellRowInput[] }[],
  opts: { pageNo?: number; startIndex?: number; headerStart?: number } = {},
): PdfField[] {
  const pageNo = opts.pageNo ?? 2;
  const fields: PdfField[] = [];
  const add = (name: string, value: string, y: number, page = pageNo): void => void fields.push({ name, value, page, x: 0, y });
  add('spellCastingClass0', casting.cls, 706);
  add('spellCastingAbility0', casting.ability, 711);
  add('spellSaveDC0', casting.dc, 711);
  add('spellAtkBonus0', casting.atk, 711);

  let y = 629;
  let spell = opts.startIndex ?? 0;
  let header = opts.headerStart ?? 0;
  for (const s of sections) {
    add(`spellHeader${header}`, s.header, y);
    add(`spellSlotHeader${header}`, s.slots, y);
    header++;
    y -= 12;
    for (const sp of s.spells) {
      add(`spellName${spell}`, sp.name, y);
      add(`spellSource${spell}`, sp.source ?? 'Cleric', y);
      add(`spellSaveHit${spell}`, sp.hit ?? '--', y);
      add(`spellCastingTime${spell}`, sp.time ?? '1A', y);
      add(`spellPrepared${spell}`, sp.prepared ?? 'O', y);
      add(`spellPage${spell}`, sp.page ?? 'PHB-2024 100', y);
      spell++;
      y -= 12;
    }
  }
  return fields;
}

/** The standard Cleric spell page used by several tests. */
export function clericSpells(): PdfField[] {
  return spellPage({ cls: 'Cleric', ability: 'WIS', dc: '14', atk: '+6' }, [
    { header: '=== CANTRIPS ===', slots: '(At Will)', spells: [{ name: 'Sacred Flame', hit: 'DEX 14' }, { name: 'Guidance' }] },
    {
      header: '=== 1st LEVEL ===',
      slots: '4 Slots OOOO',
      spells: [
        { name: 'Healing Word', time: '1BA', page: 'PHB 250' },
        { name: 'Inflict Wounds', hit: '+6', page: 'PHB 253' },
        { name: 'Healing Word', time: '1BA', page: 'PHB-2024 284' },
        { name: 'Inflict Wounds', hit: 'CON 14', page: 'PHB-2024 288' },
        { name: 'Bless', source: 'Cleric (Always Prepared)', prepared: 'P' },
        { name: 'Detect Magic [R]', time: '1A + 10m' },
      ],
    },
    { header: '=== 2nd LEVEL ===', slots: '3 Slots OOO', spells: [{ name: 'Guiding Bolt', hit: '+6' }, { name: 'Toll The Fake', hit: 'WIS 14', page: 'XGtE 1' }] },
  ]);
}
