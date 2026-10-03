import { beforeAll, describe, expect, it } from 'vitest';
import { runBulk } from './engine/bulk';
import { runFight } from './engine/fight';
import { createRng } from './engine/rng';
import { loadSrdSpells } from './data/spells';
import type { SpellDef } from './data/spellTypes';
import { sampleFight, sampleParty } from './sample';

let spells: SpellDef[];
beforeAll(async () => {
  spells = await loadSrdSpells();
});

describe('sampleParty with the SRD spell library', () => {
  it('gives the casters real spells, upcast variants and a bonus-action heal', () => {
    const [fighter, cleric, wizard] = sampleParty(spells);
    expect(fighter!.actions.map((a) => a.name)).toEqual(['Longsword']);
    expect(wizard!.actions.map((a) => a.name)).toEqual([
      'Fire Bolt',
      'Magic Missile',
      'Magic Missile (level 2)',
      'Burning Hands',
      'Burning Hands (level 2)',
      'Scorching Ray',
    ]);
    expect(cleric!.actions.map((a) => a.name)).toEqual(['Mace', 'Sacred Flame', 'Guiding Bolt', 'Guiding Bolt (level 2)']);
    expect(cleric!.heals.map((h) => [h.name, h.slotLevel, h.dice, !!h.bonus])).toEqual([
      ['Cure Wounds', 1, '2d8+3', false],
      ['Cure Wounds (level 2)', 2, '4d8+3', false],
      ['Healing Word', 1, '2d4+3', true],
      ['Healing Word (level 2)', 2, '4d4+3', true],
    ]);
  });

  it('falls back to fixed numbers without the library', () => {
    expect(sampleParty()[2]!.actions.map((a) => a.name)).toEqual(['Fire Bolt', 'Burning Hands', 'Burning Hands (2nd)']);
  });

  it('plays out a full fight, and the real spells do work', () => {
    const cfg = { combatants: [...sampleParty(spells), ...sampleFight(4).combatants.slice(3)] };
    const r = runFight(cfg, createRng('spells'), { log: true });
    const wizardActions = r.log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'Wizard' ? [l.event.option] : l.event.kind === 'save' && l.event.caster === 'Wizard' ? [l.event.option] : []));
    expect(wizardActions.length).toBeGreaterThan(0);
    expect(['won-clean', 'won-deaths', 'tpk', 'stalemate']).toContain(r.outcome);
  });

  it('wins a goblin fight about as often as the fixed-number party', () => {
    const goblins = sampleFight(4).combatants.slice(3);
    const real = runBulk({ combatants: [...sampleParty(spells), ...goblins] }, 1500, 'real');
    const fixed = runBulk({ combatants: [...sampleParty(), ...goblins] }, 1500, 'fixed');
    expect(real.winRate).toBeGreaterThan(0.9);
    expect(Math.abs(real.winRate - fixed.winRate)).toBeLessThan(0.1);
  });
});
