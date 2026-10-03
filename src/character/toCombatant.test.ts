import { beforeAll, describe, expect, it } from 'vitest';
import { runFight } from '../engine/fight';
import { createRng } from '../engine/rng';
import { makeCombatant } from '../engine/testUtil';
import { loadSrdSpells } from '../data/spells';
import type { SpellDef } from '../data/spellTypes';
import { findSpell, selectCombatSpells } from './combatSpells';
import { clericSheet, clericSpells, spellPage, toFields } from './fixtures';
import { parseCharacterSheet } from './parseCharacterSheet';
import { characterToCombatant } from './toCombatant';

let lib: SpellDef[];
beforeAll(async () => {
  lib = await loadSrdSpells();
});

const cleric = (extra: ReturnType<typeof toFields> = clericSpells(), sheet = clericSheet()) => parseCharacterSheet([...toFields(sheet), ...extra]).character;

describe('findSpell', () => {
  it('matches by name, ignoring case, ritual tags and apostrophes', () => {
    expect(findSpell(lib, 'Fireball')?.id).toBe('fireball');
    expect(findSpell(lib, 'detect magic [R]')?.id).toBe('detect-magic');
  });

  it('finds the 2024 name of a spell the sheet lists with a proper name', () => {
    expect(findSpell(lib, "Tasha's Hideous Laughter")?.id).toBe('hideous-laughter');
    expect(findSpell(lib, "Melf's Acid Arrow")?.id).toBe('acid-arrow');
    expect(findSpell(lib, 'Tasha’s Hideous Laughter')?.id).toBe('hideous-laughter');
  });

  it('returns undefined for a spell that is not in the library', () => {
    expect(findSpell(lib, 'Toll the Dead')).toBeUndefined();
    expect(findSpell(lib, 'Nonsense')).toBeUndefined();
  });
});

describe('selectCombatSpells', () => {
  const picked = (c: ReturnType<typeof cleric>) => c.spells.filter((s) => s.inCombat).map((s) => s.name);

  it('picks damage and healing spells it can simulate, and always-prepared ones with an effect', () => {
    const c = selectCombatSpells(cleric(), lib);
    expect(picked(c)).toEqual(expect.arrayContaining(['Sacred Flame', 'Healing Word', 'Inflict Wounds', 'Guiding Bolt']));
    expect(picked(c)).not.toContain('Guidance'); // no simulated effect
    expect(picked(c)).not.toContain('Bless'); // always prepared, but no effect to simulate
  });

  it('warns about a spell with a save listed that is not in the library', () => {
    const c = selectCombatSpells(cleric(), lib);
    expect(c.warnings.join(' ')).toMatch(/Not in the SRD spell library, so not simulated: Toll The Fake/);
    expect(picked(c)).not.toContain('Toll The Fake');
  });

  it('is repeatable: warnings are not duplicated', () => {
    const once = selectCombatSpells(cleric(), lib);
    const twice = selectCombatSpells(once, lib);
    expect(twice.warnings.filter((w) => w.includes('Not in the SRD spell library'))).toHaveLength(1);
  });

  it('keeps only the best two cantrips, four damage spells and two heals', () => {
    const many = spellPage({ cls: 'Wizard', ability: 'INT', dc: '14', atk: '+6' }, [
      { header: '=== CANTRIPS ===', slots: '(At Will)', spells: ['Fire Bolt', 'Ray of Frost', 'Chill Touch', 'Poison Spray'].map((name) => ({ name, source: 'Wizard', hit: '+6' })) },
      { header: '=== 1st LEVEL ===', slots: '4 Slots OOOO', spells: ['Magic Missile', 'Burning Hands', 'Thunderwave', 'Guiding Bolt', 'Dissonant Whispers', 'Ice Knife', 'Cure Wounds', 'Healing Word'].map((name) => ({ name, source: 'Wizard' })) },
    ]);
    const c = selectCombatSpells(cleric(many, clericSheet({ 'CLASS LEVEL': 'Wizard 3' })), lib);
    const chosen = c.spells.filter((s) => s.inCombat);
    expect(chosen.filter((s) => s.level === 0)).toHaveLength(2);
    expect(chosen.filter((s) => s.level === 1 && !/Cure|Healing/.test(s.name))).toHaveLength(4);
    expect(chosen.filter((s) => /Cure|Healing/.test(s.name))).toHaveLength(2);
  });

  it('ignores spells of a level the character has no slots for', () => {
    const high = spellPage({ cls: 'Wizard', ability: 'INT', dc: '14', atk: '+6' }, [
      { header: '=== 1st LEVEL ===', slots: '4 Slots OOOO', spells: [{ name: 'Magic Missile', source: 'Wizard' }] },
      { header: '=== 3rd LEVEL ===', slots: '', spells: [{ name: 'Fireball', source: 'Wizard', hit: 'DEX 14' }] },
    ]);
    const names = selectCombatSpells(cleric(high), lib).spells.filter((s) => s.inCombat).map((s) => s.name);
    expect(names).toEqual(['Magic Missile']);
  });

  it('uses one entry when a sheet lists a spell under two names', () => {
    const dup = spellPage({ cls: 'Wizard', ability: 'INT', dc: '13', atk: '+5' }, [
      { header: '=== 2nd LEVEL ===', slots: '3 Slots OOO', spells: [{ name: "Melf's Acid Arrow", hit: '+5', page: 'PHB 259' }, { name: 'Acid Arrow', hit: '+5', page: 'PHB-2024 240' }] },
    ]);
    const c = selectCombatSpells(cleric(dup), lib);
    expect(c.spells.filter((s) => s.inCombat).map((s) => s.name)).toEqual(['Acid Arrow']);
  });
});

describe('characterToCombatant', () => {
  const convert = (c = selectCombatSpells(cleric(), lib)) => characterToCombatant(c, lib);

  it('builds the creature from the sheet', () => {
    const { combatant } = convert();
    expect(combatant.team).toBe('party');
    expect(combatant.creature).toMatchObject({ id: 'test-cleric', name: 'Test Cleric', kind: 'character', ac: 13, maxHp: 31, hp: 31, status: 'alive', size: 'medium', saveBonuses: { wis: 6, cha: 5 } });
    expect(combatant.creature.abilityScores.wis).toBe(18);
    expect(combatant.slots).toEqual({ 1: 4, 2: 3 });
  });

  it('turns weapon rows into attacks and leaves out spell rows that are SRD spells', () => {
    const c = cleric(clericSpells(), clericSheet({ 'Wpn Name 3': 'Sacred Flame', 'Wpn3 AtkBonus': '', 'Wpn3 Damage': '1d8 Radiant', 'Wpn Notes 3': 'V/S' }));
    const names = convert(selectCombatSpells(c, lib)).combatant.actions.map((a) => a.name);
    expect(names.filter((n) => n === 'Sacred Flame')).toHaveLength(1); // once, from the spell, not from the table row
    expect(names).toContain('Mace');
  });

  it('repeats weapon attacks for Extra Attack but not spells', () => {
    const c = cleric(clericSpells(), clericSheet({ 'CLASS LEVEL': 'Fighter 5', FeaturesTraits2: '* Extra Attack' }));
    const { combatant } = convert(selectCombatSpells(c, lib));
    expect(combatant.actions.find((a) => a.name === 'Mace')).toMatchObject({ kind: 'attack', count: 2 });
    const flame = combatant.actions.find((a) => a.name === 'Sacred Flame');
    expect(flame?.kind).toBe('save');
  });

  it('uses each spell\'s own save DC and attack bonus from the sheet', () => {
    const { combatant } = convert();
    const flame = combatant.actions.find((a) => a.name === 'Sacred Flame');
    expect(flame?.kind === 'save' && flame.save.dc).toBe(14);
    const bolt = combatant.actions.find((a) => a.name === 'Guiding Bolt');
    expect(bolt?.kind === 'attack' && bolt.attack.toHit).toBe(6);
    const wounds = combatant.actions.find((a) => a.name === 'Inflict Wounds');
    expect(wounds?.kind === 'save' && wounds.save.ability).toBe('con'); // the 2024 version
  });

  it('makes upcast variants for the slot levels it has, and heals with the spellcasting modifier', () => {
    const { combatant } = convert();
    // The fixture lists Guiding Bolt under a 2nd-level header, but the SRD says level 1, and the SRD wins.
    expect(combatant.actions.filter((a) => a.spell === 'Guiding Bolt').map((a) => a.slotLevel)).toEqual([1, 2]);
    expect(combatant.heals.map((h) => [h.name, h.dice, !!h.bonus])).toEqual(
      expect.arrayContaining([
        ['Healing Word', '2d4+4', true],
        ['Healing Word (level 2)', '4d4+4', true],
      ]),
    ); // WIS 18 = +4
  });

  it('picks the casting class for a spell from its source, so a multiclass caster uses the right DC', () => {
    const casting = { cls: 'Cleric / Wizard', ability: 'WIS / INT', dc: '12 / 14', atk: '+4 / +6' };
    const sheet = spellPage(casting, [
      { header: '=== 1st LEVEL ===', slots: '4 Slots OOOO', spells: [{ name: 'Cure Wounds', source: 'Cleric' }, { name: 'Magic Missile', source: 'Wizard' }, { name: 'Healing Word', source: 'Magic Initiate (Wizard)' }] },
    ]);
    const base = parseCharacterSheet([...toFields(clericSheet({ 'CLASS LEVEL': 'Cleric 1 / Wizard 3', INT: '19', WIS: '14' })), ...sheet]).character;
    const { combatant } = characterToCombatant(selectCombatSpells(base, lib), lib);
    const heals = Object.fromEntries(combatant.heals.filter((h) => !h.slotLevel || h.slotLevel === 1).map((h) => [h.name, h.dice]));
    expect(heals['Cure Wounds']).toBe('2d8+2'); // Cleric: WIS 14
    expect(heals['Healing Word']).toBe('2d4+4'); // Magic Initiate (Wizard): INT 19
  });

  it('leaves out a row with no attack bonus, and reports selected spells not in the library', () => {
    const c = cleric(clericSpells(), clericSheet({ 'Wpn Name 3': 'Homebrew Blast', 'Wpn3 AtkBonus': '', 'Wpn3 Damage': '2d6 Fire', 'Wpn Notes 3': 'V/S' }));
    const sel = selectCombatSpells(c, lib);
    sel.spells.find((s) => s.name === 'Toll The Fake')!.inCombat = true;
    const r = characterToCombatant(sel, lib);
    expect(r.combatant.actions.map((a) => a.name)).not.toContain('Homebrew Blast');
    expect(r.unknownSpells).toEqual(['Toll The Fake']);
    expect(r.warnings.join(' ')).toMatch(/Homebrew Blast: no attack bonus/);
    expect(r.warnings.join(' ')).toMatch(/Not in the SRD library, so not simulated: Toll The Fake/);
  });

  it('carries defenses, condition immunities and the initiative bonus', () => {
    const c = cleric(clericSpells(), clericSheet({ Defenses: 'Resistances - Necrotic\nImmunities - Charmed', Init: '+3', DEX: '10' }));
    const { combatant } = convert(selectCombatSpells(c, lib));
    expect(combatant.creature).toMatchObject({ resistances: ['necrotic'], conditionImmunities: ['charmed'] });
    expect(combatant.initiativeBonus).toBe(3);
  });

  it('produces a combatant the fight engine can run', () => {
    const { combatant } = convert();
    const goblin = makeCombatant('goblin', 'enemies', { hp: 7, ac: 12, dmg: '1' });
    const r = runFight({ combatants: [combatant, goblin] }, createRng('imported'), { log: true });
    expect(['won-clean', 'won-deaths', 'tpk', 'stalemate']).toContain(r.outcome);
    expect(r.log.some((l) => l.event.kind === 'attack' && l.event.attacker === 'Test Cleric')).toBe(true);
  });
});
