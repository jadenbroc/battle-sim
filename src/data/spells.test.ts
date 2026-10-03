import { beforeAll, describe, expect, it } from 'vitest';
import { parseDice } from '../engine/dice';
import { runFight } from '../engine/fight';
import { createRng } from '../engine/rng';
import { makeCombatant } from '../engine/testUtil';
import { isConditionName, isDamageType, type Action, type Combatant } from '../engine/types';
import type { SpellDef } from './spellTypes';
import { CANTRIP_TIERS, addDice, areaMaxTargets, cantripTier, loadSrdSpells, searchSpells, spellToActions, spellsToActions, type CasterContext } from './spells';

let lib: SpellDef[];
const get = (id: string): SpellDef => {
  const s = lib.find((x) => x.id === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};
const ctx = (over: Partial<CasterContext> = {}): CasterContext => ({
  characterLevel: 3,
  spellAttackBonus: 5,
  spellSaveDC: 13,
  spellModifier: 3,
  ...over,
});

beforeAll(async () => {
  lib = await loadSrdSpells();
});

describe('bundled SRD spell library', () => {
  it('has the SRD 5.2.1 spells with unique ids', () => {
    expect(lib.length).toBe(339);
    expect(new Set(lib.map((s) => s.id)).size).toBe(lib.length);
    expect(lib.filter((s) => s.level === 0)).toHaveLength(27);
  });

  it('has sane fields for every spell', () => {
    for (const s of lib) {
      expect(s.level, s.name).toBeGreaterThanOrEqual(0);
      expect(s.level, s.name).toBeLessThanOrEqual(9);
      expect(s.school, s.name).not.toBe('');
      expect(s.classes.length, s.name).toBeGreaterThan(0);
      expect(s.castingTime, s.name).not.toBe('');
      expect(s.components, s.name).not.toBe('');
      expect(s.text.length, s.name).toBeGreaterThan(20);
      expect(s.text, s.name).not.toMatch(/Ã|â€|�|\*\*/);
    }
  });

  it('has valid effects: parseable dice, known damage types, known conditions', () => {
    for (const s of lib) {
      const e = s.effect;
      if (!e) continue;
      if (e.kind === 'heal') {
        expect(() => parseDice(e.dice), s.name).not.toThrow();
        continue;
      }
      expect(e.damage.length + (e.effects?.length ?? 0), s.name).toBeGreaterThan(0);
      for (const d of e.damage) {
        expect(isDamageType(d.type), `${s.name} ${d.type}`).toBe(true);
        expect(() => parseDice(d.dice), `${s.name} ${d.dice}`).not.toThrow();
      }
      for (const f of e.effects ?? []) expect(isConditionName(f.condition), `${s.name} ${f.condition}`).toBe(true);
      for (const dice of [e.scaling?.upcast?.damageDice, e.scaling?.cantrip?.damageDice]) if (dice) expect(() => parseDice(dice), s.name).not.toThrow();
    }
  });

  it('parses the classic spells correctly', () => {
    expect(get('fireball')).toMatchObject({ level: 3, castingTime: 'Action', concentration: false });
    expect(get('fireball').effect).toMatchObject({
      kind: 'save',
      ability: 'dex',
      halfOnSave: true,
      damage: [{ dice: '8d6', type: 'fire' }],
      area: { shape: 'sphere', size: 20 },
      scaling: { upcast: { above: 3, damageDice: '1d6' } },
    });
    expect(get('fire-bolt').effect).toMatchObject({ kind: 'attack', range: 'ranged', damage: [{ dice: '1d10', type: 'fire' }], scaling: { cantrip: { damageDice: '1d10' } } });
    expect(get('sacred-flame').effect).toMatchObject({ kind: 'save', ability: 'dex', halfOnSave: false, damage: [{ dice: '1d8', type: 'radiant' }] });
    expect(get('guiding-bolt').effect).toMatchObject({ kind: 'attack', damage: [{ dice: '4d6', type: 'radiant' }] });
    expect(get('magic-missile').effect).toMatchObject({ kind: 'attack', autoHit: true, count: 3, damage: [{ dice: '1d4+1', type: 'force' }] });
    expect(get('scorching-ray').effect).toMatchObject({ count: 3, damage: [{ dice: '2d6', type: 'fire' }] });
    expect(get('eldritch-blast').effect).toMatchObject({ scaling: { cantrip: { counts: [1, 2, 3, 4] } } });
    expect(get('cure-wounds').effect).toEqual({ kind: 'heal', dice: '2d8', addsModifier: true, scaling: { upcast: { above: 1, healDice: '2d8' } } });
    expect(get('healing-word').castingTime).toBe('Bonus Action');
    expect(get('heal').effect).toMatchObject({ kind: 'heal', dice: '70' });
  });

  it('leaves out what it cannot simulate, with a reason', () => {
    for (const id of ['spirit-guardians', 'moonbeam', 'hex', 'shield', 'counterspell', 'misty-step', 'fly', 'haste', 'conjure-animals', 'wall-of-fire']) {
      const s = lib.find((x) => x.id === id);
      if (!s) continue;
      expect(s.effect, id).toBeUndefined();
    }
    expect(get('spirit-guardians').notes.join(' ')).toMatch(/Zone/);
    expect(get('hellish-rebuke').notes.join(' ')).toMatch(/Casting time/);
  });

  it('counts the simulated spells', () => {
    const damaging = lib.filter((s) => s.effect && s.effect.kind !== 'heal' && s.effect.damage.length > 0);
    expect(damaging.length).toBeGreaterThanOrEqual(35);
    expect(lib.filter((s) => s.effect?.kind === 'heal').length).toBe(5);
  });
});

describe('search', () => {
  it('filters by name, level, class and whether the spell is simulated', () => {
    expect(searchSpells(lib, { query: 'fire' }).map((s) => s.id)).toEqual(expect.arrayContaining(['fireball', 'fire-bolt']));
    expect(searchSpells(lib, { level: 0 })).toHaveLength(27);
    expect(searchSpells(lib, { className: 'cleric', level: 1 }).every((s) => s.classes.includes('Cleric') && s.level === 1)).toBe(true);
    expect(searchSpells(lib, { simulated: true }).every((s) => s.effect)).toBe(true);
  });
});

describe('addDice', () => {
  it('adds same-size dice and keeps the modifier', () => {
    expect(addDice([{ dice: '8d6', type: 'fire' }], '1d6', 2)).toEqual([{ dice: '10d6', type: 'fire' }]);
    expect(addDice([{ dice: '10d6+40', type: 'force' }], '3d6', 1)).toEqual([{ dice: '13d6+40', type: 'force' }]);
    expect(addDice([{ dice: '3d6', type: 'fire' }], '1d6', 0)).toEqual([{ dice: '3d6', type: 'fire' }]);
  });

  it('adds a separate component when the dice differ', () => {
    expect(addDice([{ dice: '2d6', type: 'fire' }], '1d8', 2)).toEqual([
      { dice: '2d6', type: 'fire' },
      { dice: '2d8', type: 'fire' },
    ]);
  });
});

describe('cantrip tiers and area limits', () => {
  it('grow at character levels 5, 11 and 17', () => {
    expect(CANTRIP_TIERS).toEqual([5, 11, 17]);
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(cantripTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('small cones, cubes and spheres hit only a couple of creatures', () => {
    expect(areaMaxTargets({ shape: 'cone', size: 15 })).toBe(2);
    expect(areaMaxTargets({ shape: 'cube', size: 15 })).toBe(2);
    expect(areaMaxTargets({ shape: 'sphere', size: 5 })).toBe(2);
    expect(areaMaxTargets({ shape: 'sphere', size: 20 })).toBeUndefined();
    expect(areaMaxTargets({ shape: 'cone', size: 60 })).toBeUndefined();
    expect(areaMaxTargets(undefined)).toBeUndefined();
  });
});

describe('spellToActions', () => {
  const only = (c: { actions: Action[] }): Action => c.actions[0]!;

  it('scales a cantrip with character level', () => {
    const dice = (level: number) => {
      const a = only(spellToActions(get('fire-bolt'), ctx({ characterLevel: level })));
      return a.kind === 'attack' ? a.attack.damage[0]!.dice : '';
    };
    expect([1, 5, 11, 17].map(dice)).toEqual(['1d10', '2d10', '3d10', '4d10']);
  });

  it('turns Fire Bolt into a free ranged attack using the caster\'s spell attack bonus', () => {
    const a = only(spellToActions(get('fire-bolt'), ctx({ spellAttackBonus: 7 })));
    expect(a).toMatchObject({ kind: 'attack', name: 'Fire Bolt', attack: { toHit: 7, range: 'ranged' } });
    expect(a.slotLevel).toBeUndefined();
  });

  it('scales Eldritch Blast\'s beams with level', () => {
    const count = (level: number) => {
      const a = only(spellToActions(get('eldritch-blast'), ctx({ characterLevel: level })));
      return a.kind === 'attack' ? (a.count ?? 1) : 0;
    };
    expect([1, 5, 11, 17].map(count)).toEqual([1, 2, 3, 4]);
  });

  it('makes one Fireball variant per slot level, each stronger, using the caster\'s DC', () => {
    const c = spellToActions(get('fireball'), ctx({ slotLevels: [1, 2, 3, 4, 5], spellSaveDC: 15 }));
    expect(c.actions.map((a) => [a.name, a.slotLevel])).toEqual([
      ['Fireball', 3],
      ['Fireball (level 4)', 4],
      ['Fireball (level 5)', 5],
    ]);
    const dice = c.actions.map((a) => (a.kind === 'save' ? a.save.damage[0]!.dice : ''));
    expect(dice).toEqual(['8d6', '9d6', '10d6']);
    const first = c.actions[0]!;
    expect(first).toMatchObject({ kind: 'save', area: true, spell: 'Fireball', save: { ability: 'dex', dc: 15, halfOnSave: true } });
    expect(first.kind === 'save' && first.maxTargets).toBeUndefined();
  });

  it('only offers slot levels at or above the spell\'s level', () => {
    expect(spellToActions(get('burning-hands'), ctx({ slotLevels: [1, 2] })).actions.map((a) => a.slotLevel)).toEqual([1, 2]);
    expect(spellToActions(get('fireball'), ctx({ slotLevels: [1, 2] })).actions).toEqual([]);
    expect(spellToActions(get('fireball'), ctx()).actions.map((a) => a.slotLevel)).toEqual([3]); // default: its own level
  });

  it('limits small area spells to a couple of targets', () => {
    const a = only(spellToActions(get('burning-hands'), ctx({ slotLevels: [1] })));
    expect(a).toMatchObject({ kind: 'save', area: true, maxTargets: 2 });
  });

  it('adds extra darts and rays when upcast', () => {
    const missiles = spellToActions(get('magic-missile'), ctx({ slotLevels: [1, 2, 3] })).actions;
    expect(missiles.map((a) => (a.kind === 'attack' ? a.count : 0))).toEqual([3, 4, 5]);
    expect(missiles[0]).toMatchObject({ attack: { autoHit: true, damage: [{ dice: '1d4+1', type: 'force' }] } });
    const rays = spellToActions(get('scorching-ray'), ctx({ slotLevels: [2, 3] })).actions;
    expect(rays.map((a) => (a.kind === 'attack' ? a.count : 0))).toEqual([3, 4]);
  });

  it('makes healing with the spellcasting modifier and upcast dice', () => {
    const c = spellToActions(get('cure-wounds'), ctx({ slotLevels: [1, 2], spellModifier: 3 }));
    expect(c.heals.map((h) => [h.name, h.slotLevel, h.dice])).toEqual([
      ['Cure Wounds', 1, '2d8+3'],
      ['Cure Wounds (level 2)', 2, '4d8+3'],
    ]);
    expect(spellToActions(get('cure-wounds'), ctx({ spellModifier: 0 })).heals[0]!.dice).toBe('2d8');
    expect(spellToActions(get('cure-wounds'), ctx({ spellModifier: -1 })).heals[0]!.dice).toBe('2d8-1');
    expect(spellToActions(get('heal'), ctx({ slotLevels: [6] })).heals[0]!.dice).toBe('70');
  });

  it('puts Healing Word in the bonus action slot', () => {
    expect(spellToActions(get('healing-word'), ctx()).heals[0]).toMatchObject({ bonus: true });
  });

  it('fills the caster\'s DC into a repeated save', () => {
    const a = only(spellToActions(get('hold-person'), ctx({ spellSaveDC: 16, slotLevels: [2] })));
    expect(a.kind === 'save' && a.save.effects?.[0]?.repeatSave).toEqual({ ability: 'wis', dc: 16 });
  });

  it('returns nothing, with a warning, for a spell it cannot simulate', () => {
    const c = spellToActions(get('spirit-guardians'), ctx());
    expect(c.actions).toEqual([]);
    expect(c.heals).toEqual([]);
    expect(c.warnings[0]).toMatch(/Spirit Guardians: not simulated \(Zone/);
  });

  it('warns about parts of a spell that are only partly simulated', () => {
    expect(spellToActions(get('phantasmal-killer'), ctx({ slotLevels: [4] })).warnings.join(' ')).toMatch(/Concentration is not modelled/);
  });

  it('converts a list of spells together', () => {
    const c = spellsToActions([get('fire-bolt'), get('magic-missile'), get('cure-wounds'), get('hex')], ctx({ slotLevels: [1, 2] }));
    expect(c.actions.map((a) => a.name)).toEqual(['Fire Bolt', 'Magic Missile', 'Magic Missile (level 2)']);
    expect(c.heals).toHaveLength(2);
    expect(c.warnings.some((w) => w.startsWith('Hex: not simulated'))).toBe(true);
  });
});

describe('spells in a fight', () => {
  const caster = (spells: string[], over: Partial<CasterContext> = {}): Combatant => {
    const c = spellsToActions(spells.map(get), ctx({ slotLevels: [1, 2, 3], ...over }));
    const w = makeCombatant('wizard', 'party', { hp: 100000, ac: 30 });
    w.actions = c.actions;
    w.heals = c.heals;
    w.slots = { 1: 4, 2: 3, 3: 2 };
    w.initiativeBonus = 100;
    return w;
  };
  const target = (): Combatant => makeCombatant('target', 'enemies', { hp: 100000, ac: 1, dmg: '0', toHit: -10 });

  it('Magic Missile darts hit automatically, with no attack roll', () => {
    const w = caster(['magic-missile']);
    w.slots = { 1: 4 };
    const r = runFight({ combatants: [w, target()], options: { roundCap: 1 } }, createRng('mm'), { log: true });
    const darts = r.log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'wizard' ? [l.event] : []));
    expect(darts).toHaveLength(3);
    expect(darts.every((d) => d.autoHit && d.attackRoll.hit && !d.attackRoll.crit && d.attackRoll.roll.rolls.length === 0)).toBe(true);
    expect(darts.every((d) => d.totalDamage >= 2 && d.totalDamage <= 5)).toBe(true); // 1d4+1
  });

  it('a caster burns slots lowest-first and falls back to cantrips', () => {
    const w = caster(['fire-bolt', 'burning-hands'], { slotLevels: [1] });
    w.slots = { 1: 2 };
    const r = runFight({ combatants: [w, target()], options: { roundCap: 4 } }, createRng('slots'), { log: true });
    const used = r.log.flatMap((l) => {
      const e = l.event;
      if (e.kind === 'save' && e.caster === 'wizard') return [e.option];
      if (e.kind === 'attack' && e.attacker === 'wizard') return [e.option];
      return [];
    });
    expect(used).toEqual(['Burning Hands', 'Burning Hands', 'Fire Bolt', 'Fire Bolt']);
  });

  it('a cleric heals a badly hurt ally with Cure Wounds', () => {
    const cleric = caster(['sacred-flame', 'cure-wounds']);
    const hurt = makeCombatant('hurt', 'party', { hp: 100, ac: 30 });
    hurt.creature.hp = 10;
    const r = runFight({ combatants: [cleric, hurt, target()], options: { roundCap: 1 } }, createRng('cure'), { log: true });
    const heal = r.log.find((l) => l.event.kind === 'heal');
    expect(heal?.event).toMatchObject({ actor: 'wizard', target: 'hurt', option: 'Cure Wounds' });
  });

  it('every simulated spell can be cast in a fight without errors', () => {
    for (const s of lib.filter((x) => x.effect)) {
      const slotLevels = Array.from({ length: 9 - s.level + 1 }, (_, i) => s.level + i).filter((l) => l > 0);
      const w = caster([s.id], { slotLevels, characterLevel: 20 });
      w.slots = Object.fromEntries(slotLevels.map((l) => [l, 3]));
      const ally = makeCombatant('ally', 'party', { hp: 100000, ac: 30 });
      ally.creature.hp = 1;
      const r = runFight({ combatants: [w, ally, target()], options: { roundCap: 3 } }, createRng(s.id), { log: true });
      expect(r.log.length, s.name).toBeGreaterThan(1);
    }
  });
});
