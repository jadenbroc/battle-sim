import { beforeAll, describe, expect, it } from 'vitest';
import { parseDice } from '../engine/dice';
import { ABILITIES, isDamageType } from '../engine/types';
import { runFight } from '../engine/fight';
import { createRng } from '../engine/rng';
import { makeCombatant } from '../engine/testUtil';
import type { MonsterDef } from './monsterTypes';
import { buildEnemyGroup, engineActions, loadSrdMonsters, monsterToCombatants } from './monsters';

let lib: MonsterDef[];
const get = (id: string): MonsterDef => {
  const m = lib.find((x) => x.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};

beforeAll(async () => {
  lib = await loadSrdMonsters();
});

describe('bundled SRD library', () => {
  it('has the SRD 5.2.1 monsters, with unique ids', () => {
    expect(lib.length).toBe(330);
    expect(new Set(lib.map((m) => m.id)).size).toBe(lib.length);
  });

  it('has the 2024 versions of the classic monsters, not the older ones', () => {
    const ids = new Set(lib.map((m) => m.id));
    for (const id of ['goblin', 'bugbear', 'hobgoblin', 'acolyte', 'veteran', 'minotaur']) expect(ids.has(id)).toBe(false);
    for (const id of ['goblin-warrior', 'goblin-boss', 'wolf', 'owlbear', 'troll', 'adult-red-dragon', 'ancient-red-dragon', 'remorhaz', 'will-o-wisp']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('has correct ability scores where a second dataset was wrong', () => {
    expect(get('troll').abilityScores).toEqual({ str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7 });
    expect(get('swarm-of-insects').abilityScores).toMatchObject({ wis: 7, cha: 1 });
    expect(get('violet-fungus').abilityScores).toMatchObject({ wis: 3, cha: 1 });
  });

  it('keeps each monster\'s own actions (no records mixed up)', () => {
    expect(get('guard').actions.map((a) => a.name)).not.toContain('Claw');
    expect(get('cultist').actions.map((a) => a.name)).not.toContain('Pact Blade');
    expect(get('spider').actions.map((a) => a.name)).not.toContain('Bites');
    expect(get('ancient-red-dragon').abilityScores).toEqual({ str: 30, dex: 10, con: 29, int: 18, wis: 15, cha: 27 });
    expect(get('ancient-red-dragon').saveBonuses).toEqual({ dex: 7, wis: 9 });
    expect(get('will-o-wisp').abilityScores.str).toBe(1);
  });

  it('has sane numbers and parseable dice for every monster', () => {
    for (const m of lib) {
      expect(m.ac, m.name).toBeGreaterThan(0);
      expect(m.hp, m.name).toBeGreaterThan(0);
      expect(Number.isFinite(m.crValue), m.name).toBe(true);
      for (const ab of ABILITIES) expect(Number.isFinite(m.abilityScores[ab]), `${m.name} ${ab}`).toBe(true);
      for (const t of [...m.resistances, ...m.vulnerabilities, ...m.immunities]) expect(isDamageType(t), `${m.name} ${t}`).toBe(true);
      for (const a of m.actions) {
        const parts = a.kind === 'attack' ? a.attack.damage : a.save.damage;
        expect(parts.length, `${m.name} ${a.name}`).toBeGreaterThan(0);
        for (const p of parts) {
          expect(isDamageType(p.type), `${m.name} ${a.name} ${p.type}`).toBe(true);
          expect(() => parseDice(p.dice), `${m.name} ${a.name} ${p.dice}`).not.toThrow();
        }
        if (a.kind === 'attack') expect(Number.isFinite(a.attack.toHit), `${m.name} ${a.name}`).toBe(true);
        else expect(a.save.dc, `${m.name} ${a.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('has no encoding damage in names or text', () => {
    const bad = /Ã|â€|�/;
    for (const m of lib) {
      expect(m.name).not.toMatch(bad);
      for (const f of [...m.traits, ...m.bonusActions, ...m.reactions, ...m.otherActions]) expect(f.text, m.name).not.toMatch(bad);
    }
  });

  it('parses the Goblin Warrior', () => {
    const g = get('goblin-warrior');
    expect(g).toMatchObject({ ac: 15, hp: 10, cr: '1/4', crValue: 0.25, type: 'fey', initiativeBonus: 0 });
    const scimitar = g.actions.find((a) => a.name === 'Scimitar');
    expect(scimitar).toMatchObject({ kind: 'attack', attack: { toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } });
  });

  it('parses the Wolf bite across the source line wrap', () => {
    const w = get('wolf');
    expect(w.actions[0]).toMatchObject({ name: 'Bite', attack: { toHit: 4, damage: [{ dice: '1d6+2', type: 'piercing' }] } });
  });

  it('turns the Owlbear multiattack into two Rend attacks', () => {
    const o = get('owlbear');
    const multi = engineActions(o).find((a) => a.name === 'Multiattack');
    expect(multi?.kind === 'attack' && multi.sequence).toHaveLength(2);
  });

  it('keeps the dragon breath out of fights but still lists it', () => {
    const d = get('adult-red-dragon');
    expect(d.actions.find((a) => a.name === 'Fire Breath')).toMatchObject({ limit: 'Recharge 5-6', area: true });
    expect(engineActions(d).some((a) => a.name === 'Fire Breath')).toBe(false);
    expect(d.immunities).toEqual(['fire']);
  });

  it('can fight: a real SRD group against a strong hero', () => {
    const { combatants } = buildEnemyGroup(lib, [
      { id: 'goblin-warrior', count: 3 },
      { id: 'wolf', count: 2 },
    ]);
    expect(combatants).toHaveLength(5);
    const hero = makeCombatant('hero', 'party', { toHit: 25, dmg: '100', hp: 80, ac: 20 });
    const r = runFight({ combatants: [hero, ...combatants] }, createRng('srd'), { log: true });
    expect(r.outcome).toBe('won-clean');
    expect(r.log.some((l) => l.event.kind === 'attack' && l.event.attacker.startsWith('Wolf'))).toBe(true);
  });

  it('runs every monster in a fight without throwing', () => {
    const hero = makeCombatant('hero', 'party', { toHit: 10, dmg: '1d8+5', hp: 200, ac: 18 });
    for (const m of lib) {
      const enemies = monsterToCombatants(m, 1);
      const r = runFight({ combatants: [hero, ...enemies], options: { roundCap: 5 } }, createRng(m.id));
      expect(['won-clean', 'won-deaths', 'tpk', 'stalemate'], m.name).toContain(r.outcome);
    }
  });
});
