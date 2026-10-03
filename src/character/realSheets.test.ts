import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSrdSpells } from '../data/spells';
import type { SpellDef } from '../data/spellTypes';
import { selectCombatSpells } from './combatSpells';
import type { Character } from './characterTypes';
import { missingRequired, parseCharacterSheet } from './parseCharacterSheet';
import { readPdfFields, type PdfJsLike } from './pdfFields';
import { characterToCombatant } from './toCombatant';

// These run against the four real D&D Beyond exports in `test characters/` (gitignored: they carry a
// player name and non-SRD content), so they are skipped when the folder is absent, as in a fresh clone.
const dir = join(import.meta.dirname, '..', '..', 'test characters');
const files: Record<string, string> = {
  'Lady Moonfire': 'jadenbroc_113258268.pdf',
  'Curuvar the Brazen': 'jadenbroc_113262688.pdf',
  'Haydon Hallowedridge': 'jadenbroc_125726136.pdf',
  'Lucien Kaelis': 'jadenbroc_165973704.pdf',
};
const present = existsSync(dir) && Object.values(files).every((f) => existsSync(join(dir, f)));

describe.skipIf(!present)('the real sample sheets', () => {
  const sheets = new Map<string, Character>();
  let lib: SpellDef[];

  beforeAll(async () => {
    lib = await loadSrdSpells();
    for (const [name, file] of Object.entries(files)) {
      const fields = await readPdfFields(new Uint8Array(readFileSync(join(dir, file))), pdfjs as unknown as PdfJsLike);
      sheets.set(name, parseCharacterSheet(fields).character);
    }
  });
  const sheet = (n: string): Character => sheets.get(n)!;

  it('reads name, class, level, AC and max HP of all four', () => {
    expect(sheet('Lady Moonfire')).toMatchObject({ name: 'Lady Moonfire', classes: [{ name: 'Cleric', level: 4 }], ac: 13, maxHp: 31, hitDice: '4d8' });
    expect(sheet('Curuvar the Brazen')).toMatchObject({ classes: [{ name: 'Wizard', level: 4 }], ac: 10, maxHp: 26 });
    expect(sheet('Haydon Hallowedridge')).toMatchObject({ classes: [{ name: 'Paladin', level: 4 }], ac: 18, maxHp: 38 });
    expect(sheet('Lucien Kaelis')).toMatchObject({
      classes: [
        { name: 'Cleric', level: 1 },
        { name: 'Wizard', level: 3 },
      ],
      ac: 15,
      maxHp: 32,
      hitDice: '1d8 + 3d6',
    });
  });

  it('reads the ability scores and saving throws', () => {
    expect(sheet('Lady Moonfire').abilityScores).toEqual({ str: 8, dex: 10, con: 14, int: 12, wis: 18, cha: 16 });
    expect(sheet('Lady Moonfire').saveBonuses).toEqual({ wis: 6, cha: 5 });
    expect(sheet('Haydon Hallowedridge').abilityScores).toEqual({ str: 18, dex: 14, con: 18, int: 10, wis: 12, cha: 18 });
    expect(sheet('Lucien Kaelis').abilityScores.int).toBe(19);
  });

  it('reads the attacks table, including a field name with trailing spaces', () => {
    expect(sheet('Lady Moonfire').attacks.map((a) => [a.name, a.toHit])).toEqual([['Mace', 1]]);
    expect(sheet('Haydon Hallowedridge').attacks.map((a) => [a.name, a.damage[0]!.dice])).toEqual([
      ['Quarterstaff', '1d6+4'],
      ['Unarmed Strike', '5'],
    ]);
    // "Wpn3 AtkBonus" has trailing spaces in its field name in the real file.
    expect(sheet('Lucien Kaelis').attacks.find((a) => a.name === 'Shocking Grasp')!.toHit).toBe(6);
  });

  it('reads defenses', () => {
    expect(sheet('Lucien Kaelis').resistances).toEqual(['necrotic']);
  });

  it('reads spell slots and casting numbers, per class for the multiclass sheet', () => {
    expect(sheet('Lady Moonfire').slots).toEqual({ 1: 4, 2: 3 });
    expect(sheet('Lady Moonfire').spellcasting).toEqual([{ name: 'Cleric', ability: 'wis', saveDC: 14, attackBonus: 6 }]);
    expect(sheet('Lucien Kaelis').spellcasting).toEqual([
      { name: 'Cleric', ability: 'wis', saveDC: 12, attackBonus: 4 },
      { name: 'Wizard', ability: 'int', saveDC: 14, attackBonus: 6 },
    ]);
    expect(sheet('Haydon Hallowedridge').slots).toEqual({ 1: 3 });
  });

  it('merges the 2014 and 2024 versions of duplicated spells, keeping the 2024 mechanics', () => {
    const names = sheet('Lady Moonfire').spells.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const wounds = sheet('Lady Moonfire').spells.find((s) => s.name === 'Inflict Wounds')!;
    expect(wounds.save).toEqual({ ability: 'con', dc: 14 }); // the 2024 version is a CON save, not an attack roll
  });

  it('puts spells in the right level, including those on the second spell page', () => {
    const lucien = sheet('Lucien Kaelis');
    expect(lucien.spells.find((s) => s.name === 'Infestation')!.level).toBe(0);
    expect(lucien.spells.find((s) => s.name === 'Magic Missile')!.level).toBe(1);
    expect(lucien.spells.find((s) => s.name === 'Wither and Bloom')!.level).toBe(2);
  });

  it('is usable for all four once combat spells are chosen', () => {
    for (const name of Object.keys(files)) {
      const c = selectCombatSpells(sheet(name), lib);
      expect(missingRequired(c), name).toEqual([]);
      const { combatant } = characterToCombatant(c, lib);
      expect(combatant.actions.length, name).toBeGreaterThan(0);
    }
  });

  it('warns about a spell that is not in the SRD library', () => {
    const c = selectCombatSpells(sheet('Lady Moonfire'), lib);
    expect(c.warnings.join(' ')).toMatch(/Toll the Dead/);
  });

  it('puts no player name in anything the app keeps', () => {
    for (const c of sheets.values()) expect(JSON.stringify(c).toLowerCase()).not.toContain('jadenbroc');
  });
});
