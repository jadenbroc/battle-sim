import { describe, expect, it } from 'vitest';
import { runFight, type FightConfig, type LoggedEvent } from './fight';
import { createRng } from './rng';
import { planTurn, usableOptions } from './tactics';
import { makeCombatant, scriptedRng } from './testUtil';
import { hasUses, initialUses, type Action, type Combatant, type SaveAction } from './types';

const breath = (limit: SaveAction['limit'], extra: Partial<SaveAction> = {}): SaveAction => ({
  kind: 'save',
  name: 'Breath',
  limit,
  save: { name: 'Breath', ability: 'dex', dc: 40, halfOnSave: false, damage: [{ dice: '10d6', type: 'fire' }] },
  ...extra,
});

const strike = (name = 'Strike', bonus = false): Action => ({
  kind: 'attack',
  name,
  ...(bonus ? { bonus: true } : {}),
  attack: { name, toHit: 30, damage: [{ dice: '1', type: 'slashing' }] },
});

/** A harmless, very sturdy party member so long fights keep going. */
const punchingBag = (): Combatant => makeCombatant('hero', 'party', { dmg: '0', toHit: -10, hp: 100000, ac: 30 });

const kinds = (log: LoggedEvent[]): string[] => log.map((l) => l.event.kind);

describe('use limits', () => {
  it('starts recharge abilities available and per-day abilities full', () => {
    expect(initialUses({ kind: 'recharge', min: 5 })).toBe(1);
    expect(initialUses({ kind: 'perDay', uses: 3 })).toBe(3);
    expect(hasUses({}, { name: 'Free' })).toBe(true);
    expect(hasUses({}, { name: 'Breath', limit: { kind: 'recharge', min: 5 } })).toBe(true);
    expect(hasUses({ usesLeft: { Breath: 0 } }, { name: 'Breath', limit: { kind: 'recharge', min: 5 } })).toBe(false);
  });

  it('keeps spent abilities out of the usable options', () => {
    const opts = [breath({ kind: 'recharge', min: 5 }), strike()] as Action[];
    expect(usableOptions(opts, {}, {}).map((o) => o.name)).toEqual(['Breath', 'Strike']);
    expect(usableOptions(opts, {}, { usesLeft: { Breath: 0 } }).map((o) => o.name)).toEqual(['Strike']);
  });
});

describe('recharge abilities in a fight', () => {
  const dragon = (limit: SaveAction['limit']): Combatant => {
    const d = makeCombatant('dragon', 'enemies', { hp: 500, ac: 30, toHit: 30, dmg: '1' });
    d.actions = [strike(), breath(limit)];
    d.initiativeBonus = 100;
    return d;
  };

  it('uses the breath first, then only after a successful recharge roll', () => {
    const r = runFight({ combatants: [punchingBag(), dragon({ kind: 'recharge', min: 5 })], options: { roundCap: 30 } }, createRng('recharge'), { log: true });
    let charged = true;
    let breaths = 0;
    for (const { event } of r.log) {
      if (event.kind === 'save' && event.option === 'Breath') {
        expect(charged, 'breath used while recharging').toBe(true);
        charged = false;
        breaths++;
      } else if (event.kind === 'recharge') {
        expect(charged, 'rolled to recharge while already charged').toBe(false);
        expect(event.success).toBe(event.roll >= 5);
        if (event.success) charged = true;
      }
    }
    expect(breaths).toBeGreaterThan(2); // 30 rounds at 1/3 recharge odds
    expect(breaths).toBeLessThan(30);
  });

  it('recharges at about the stated odds', () => {
    let rolls = 0;
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      const r = runFight({ combatants: [punchingBag(), dragon({ kind: 'recharge', min: 6 })] }, createRng(`odds${i}`), { log: true });
      for (const { event } of r.log) {
        if (event.kind === 'recharge') {
          rolls++;
          if (event.success) hits++;
        }
      }
    }
    expect(hits / rolls).toBeGreaterThan(1 / 6 - 0.05);
    expect(hits / rolls).toBeLessThan(1 / 6 + 0.05);
  });

  it('never rolls to recharge for unlimited actions', () => {
    const d = makeCombatant('dragon', 'enemies', { hp: 500, ac: 30, toHit: 30, dmg: '1' });
    const r = runFight({ combatants: [punchingBag(), d], options: { roundCap: 5 } }, createRng(1), { log: true });
    expect(kinds(r.log)).not.toContain('recharge');
  });
});

describe('per-day abilities in a fight', () => {
  it('uses an N/day ability exactly N times and never recharges it', () => {
    const m = makeCombatant('mage', 'enemies', { hp: 500, ac: 30, toHit: 30, dmg: '1' });
    m.actions = [strike(), breath({ kind: 'perDay', uses: 2 })];
    m.initiativeBonus = 100;
    const r = runFight({ combatants: [punchingBag(), m], options: { roundCap: 15 } }, createRng('perday'), { log: true });
    const uses = r.log.filter((l) => l.event.kind === 'save' && l.event.option === 'Breath');
    expect(uses).toHaveLength(2);
    expect(kinds(r.log)).not.toContain('recharge');
  });
});

describe('bonus actions', () => {
  it('takes one action and one bonus action per turn', () => {
    const c = makeCombatant('rogue', 'enemies', { hp: 500, ac: 30 });
    c.actions = [strike('Main'), strike('Offhand', true)];
    c.initiativeBonus = 100;
    const r = runFight({ combatants: [punchingBag(), c], options: { roundCap: 4 } }, createRng('bonus'), { log: true });
    const options = r.log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'rogue' ? [l.event.option] : []));
    expect(options).toEqual(['Main', 'Offhand', 'Main', 'Offhand', 'Main', 'Offhand', 'Main', 'Offhand']);
  });

  it('a creature with only a bonus action still acts', () => {
    const c = makeCombatant('imp', 'enemies', { hp: 500, ac: 30 });
    c.actions = [strike('Nip', true)];
    const r = runFight({ combatants: [punchingBag(), c], options: { roundCap: 2 } }, createRng('bonus-only'), { log: true });
    expect(kinds(r.log)).not.toContain('no-action');
    expect(r.log.some((l) => l.event.kind === 'attack' && l.event.option === 'Nip')).toBe(true);
  });

  it('can heal with a bonus action and still attack with the action', () => {
    const cleric = makeCombatant('cleric', 'party', { hp: 50, ac: 30 });
    cleric.heals = [{ name: 'Healing Word', dice: '2d4+3', bonus: true }];
    cleric.actions = [strike('Mace')];
    cleric.initiativeBonus = 100;
    const hurt = makeCombatant('hurt', 'party', { hp: 100000, ac: 30 });
    hurt.creature.hp = 5;
    const foe = makeCombatant('foe', 'enemies', { hp: 100000, ac: 30, dmg: '0', toHit: -10 });
    const r = runFight({ combatants: [cleric, hurt, foe], options: { roundCap: 1 } }, createRng('healing-word'), { log: true });
    const turn = r.log.filter((l) => (l.event.kind === 'attack' && l.event.attacker === 'cleric') || l.event.kind === 'heal').map((l) => l.event.kind);
    expect(turn.slice(0, 2)).toEqual(['attack', 'heal']);
  });
});

describe('planTurn slots', () => {
  const rng = scriptedRng([]);

  it('plans the action slot from non-bonus options only', () => {
    const c = makeCombatant('c', 'party');
    c.actions = [strike('Main'), strike('Offhand', true)];
    const foe = makeCombatant('foe', 'enemies');
    expect(planTurn(c, [c, foe], rng, 3, 'action')?.kind === 'attack' && (planTurn(c, [c, foe], rng, 3, 'action') as { action: Action }).action.name).toBe('Main');
    const bonus = planTurn(c, [c, foe], rng, 3, 'bonus');
    expect(bonus?.kind === 'attack' && bonus.action.name).toBe('Offhand');
  });

  it('returns null for the bonus slot when there are no bonus options', () => {
    const c = makeCombatant('c', 'party');
    const foe = makeCombatant('foe', 'enemies');
    expect(planTurn(c, [c, foe], rng, 3, 'bonus')).toBeNull();
  });

  it('does not plan a spent recharge ability', () => {
    const c = makeCombatant('c', 'party');
    c.actions = [strike('Weak'), breath({ kind: 'recharge', min: 5 })];
    c.usesLeft = { Breath: 0 };
    const foe = makeCombatant('foe', 'enemies', { ac: 1 });
    const plan = planTurn(c, [c, foe], rng, 3);
    expect(plan?.kind).toBe('attack');
  });
});

describe('config', () => {
  it('lets a fight config carry limited actions untouched', () => {
    const cfg: FightConfig = { combatants: [punchingBag(), makeCombatant('m', 'enemies')] };
    cfg.combatants[1]!.actions = [breath({ kind: 'recharge', min: 5 })];
    runFight(cfg, createRng(1), { log: false });
    expect(cfg.combatants[1]!.usesLeft).toBeUndefined(); // the fight works on a copy
  });
});
