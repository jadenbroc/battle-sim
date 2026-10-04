import { describe, expect, it } from 'vitest';
import { withChosenType } from './damage';
import { runFight } from './fight';
import { createRng } from './rng';
import { expectedAttackDamage } from './tactics';
import { makeCombatant } from './testUtil';
import type { AttackAction, AttackOption, Combatant, DamageType } from './types';

const orbOption = (types: DamageType[] = ['acid', 'cold', 'fire']): AttackOption => ({
  name: 'Chromatic Orb',
  toHit: 30,
  range: 'ranged',
  damage: [{ dice: '3d8', type: types[0]! }],
  damageTypes: types,
});
const none = { resistances: [], vulnerabilities: [], immunities: [] };

describe('choosing a damage type', () => {
  it('uses the first type when nothing matters', () => {
    expect(withChosenType(orbOption(), none).damage[0]!.type).toBe('acid');
  });
  it('avoids immunity and resistance and prefers vulnerability', () => {
    expect(withChosenType(orbOption(), { ...none, immunities: ['acid'] }).damage[0]!.type).toBe('cold');
    expect(withChosenType(orbOption(), { ...none, immunities: ['acid'], resistances: ['cold'] }).damage[0]!.type).toBe('fire');
    expect(withChosenType(orbOption(), { ...none, vulnerabilities: ['fire'] }).damage[0]!.type).toBe('fire');
  });
  it('leaves an ordinary attack alone', () => {
    const plain: AttackOption = { name: 'Sword', toHit: 5, damage: [{ dice: '1d8', type: 'slashing' }] };
    expect(withChosenType(plain, { ...none, immunities: ['slashing'] })).toBe(plain);
  });
  it('is counted when valuing the attack', () => {
    const fireproof = makeCombatant('t', 'enemies', { ac: 1 });
    fireproof.creature.immunities = ['acid'];
    const plain: AttackOption = { ...orbOption(['acid']), damageTypes: undefined };
    expect(expectedAttackDamage(plain, fireproof.creature)).toBe(0);
    expect(expectedAttackDamage(orbOption(), fireproof.creature)).toBeGreaterThan(10);
  });
  it('is applied in a fight', () => {
    const caster = makeCombatant('mage', 'party', {});
    caster.actions = [{ kind: 'attack', name: 'Chromatic Orb', attack: orbOption() }];
    const foe = makeCombatant('foe', 'enemies', { hp: 500, dmg: '0', toHit: -10 });
    foe.creature.immunities = ['acid'];
    foe.creature.resistances = ['cold'];
    const { log } = runFight({ combatants: [caster, foe] }, createRng('orb'), { log: true });
    const hits = log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'mage' ? l.event.damage : []));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((d) => d.type === 'fire')).toBe(true);
  });
});

describe('leaping', () => {
  const caster = (chance: number, max: number): Combatant => {
    const c = makeCombatant('mage', 'party', { dex: 30 });
    const action: AttackAction = { kind: 'attack', name: 'Chromatic Orb', attack: orbOption(), leap: { chance, max } };
    c.actions = [action];
    return c;
  };
  const dummy = (id: string): Combatant => makeCombatant(id, 'enemies', { hp: 500, dmg: '0', toHit: -10, ac: 1 });
  const mageAttacks = (chance: number, max: number, foes: number) => {
    const config = { combatants: [caster(chance, max), ...Array.from({ length: foes }, (_, i) => dummy(`foe${i}`))] };
    const { log } = runFight(config, createRng('leap'), { log: true });
    return log.flatMap((l) => (l.round === 1 && l.event.kind === 'attack' && l.event.attacker === 'mage' ? [l.event] : []));
  };

  it('jumps to a different enemy each time, up to the maximum', () => {
    const a = mageAttacks(1, 2, 4);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((e) => e.target)).size).toBe(3);
  });
  it('stops when no other enemy is left', () => {
    expect(mageAttacks(1, 5, 2)).toHaveLength(2);
  });
  it('never jumps with no chance', () => {
    expect(mageAttacks(0, 3, 4)).toHaveLength(1);
  });
});
