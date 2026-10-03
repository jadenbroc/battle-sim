import { describe, expect, it } from 'vitest';
import { runFight, rollInitiative, type FightConfig, type LoggedEvent } from './fight';
import { createRng } from './rng';
import { makeCombatant, scriptedRng } from './testUtil';
import type { ActiveCondition, AttackOption, Combatant, ConditionEffect, ConditionName } from './types';

/** A monster whose every attack hits (barring a natural 1) and inflicts `effects`. */
function biter(id: string, effects: ConditionEffect[], over: Parameters<typeof makeCombatant>[2] = {}): Combatant {
  const m = makeCombatant(id, 'enemies', { hp: 100000, ac: 30, toHit: 30, dmg: '1', initiativeBonus: 100, ...over });
  const attack: AttackOption = { name: 'Bite', toHit: 30, damage: [{ dice: '1', type: 'piercing' }], effects };
  m.actions = [{ kind: 'attack', name: 'Bite', attack }];
  return m;
}

/** A sturdy, harmless hero. */
const hero = (over: Parameters<typeof makeCombatant>[2] = {}): Combatant =>
  makeCombatant('hero', 'party', { dmg: '0', toHit: 30, hp: 100000, ac: 5, ...over });

const cond = (name: ConditionName, over: Partial<ActiveCondition> = {}): ActiveCondition => ({ name, duration: { kind: 'indefinite' }, ...over });
const run = (cfg: FightConfig, seed = 'cond'): LoggedEvent[] => runFight(cfg, createRng(seed), { log: true }).log;
const kinds = (log: LoggedEvent[], kind: string): LoggedEvent[] => log.filter((l) => l.event.kind === kind);
const round = (log: LoggedEvent[], n: number): LoggedEvent[] => log.filter((l) => l.round === n);

describe('turns', () => {
  it('a Stunned creature cannot act but its turn still passes', () => {
    const h = hero();
    h.creature.conditions = [cond('stunned')];
    const log = run({ combatants: [h, biter('ogre', [])], options: { roundCap: 2 } });
    expect(kinds(log, 'skip')).toHaveLength(2);
    expect(kinds(log, 'skip')[0]!.event).toMatchObject({ actor: 'hero', reason: 'stunned' });
    expect(log.some((l) => l.event.kind === 'attack' && l.event.attacker === 'hero')).toBe(false);
  });

  it('attacks on a Paralyzed hero are automatic crits', () => {
    const h = hero();
    h.creature.conditions = [cond('paralyzed')];
    const log = run({ combatants: [h, biter('ogre', [])], options: { roundCap: 6 } });
    const hits = log.flatMap((l) => (l.event.kind === 'attack' && l.event.attackRoll.hit ? [l.event.attackRoll.crit] : []));
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every(Boolean)).toBe(true);
  });

  it('a Charmed creature never attacks its charmer', () => {
    const h = hero();
    h.creature.conditions = [cond('charmed', { sourceId: 'witch' })];
    const witch = biter('witch', [], { initiativeBonus: 0 });
    const goon = biter('goon', [], { initiativeBonus: 0 });
    const log = run({ combatants: [h, witch, goon], options: { roundCap: 6 } });
    const targets = log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'hero' ? [l.event.target] : []));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t === 'goon')).toBe(true);
  });
});

describe('condition durations in a fight', () => {
  it('"until the end of its next turn" lasts through the target\'s next turn', () => {
    const ogre = biter('ogre', [{ condition: 'poisoned', duration: { kind: 'endOfTargetNextTurn' } }]);
    const log = run({ combatants: [hero(), ogre], options: { roundCap: 3 } });
    const r1 = round(log, 1).map((l) => l.event.kind);
    // Ogre bites first (poisoning the hero), the hero acts poisoned, then the effect ends.
    const bite = r1.indexOf('attack');
    const ended = r1.indexOf('condition-end');
    expect(bite).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(bite);
    const heroAttack = round(log, 1).findIndex((l) => l.event.kind === 'attack' && l.event.attacker === 'hero');
    expect(heroAttack).toBeLessThan(round(log, 1).findIndex((l) => l.event.kind === 'condition-end'));
    const heroEvent = round(log, 1)[heroAttack]!.event;
    expect(heroEvent.kind === 'attack' && heroEvent.mode).toBe('disadvantage'); // Poisoned
  });

  it('a Prone hero stands up at the start of its own turn', () => {
    const ogre = biter('ogre', [{ condition: 'prone', duration: { kind: 'indefinite' } }]);
    const log = run({ combatants: [hero(), ogre], options: { roundCap: 3 } });
    expect(kinds(log, 'condition-end')).toHaveLength(3);
    expect(kinds(log, 'condition-end').every((l) => l.event.kind === 'condition-end' && l.event.reason === 'stood-up')).toBe(true);
    // The ogre acts before the hero each round, so the hero is always back on its feet for the next bite.
    const ogreModes = log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'ogre' ? [l.event.mode] : []));
    expect(ogreModes.every((m) => m === 'normal')).toBe(true);
  });

  it('while Prone, a second melee attacker acting before the hero gets advantage', () => {
    const knocker = biter('knocker', [{ condition: 'prone', duration: { kind: 'indefinite' } }], { initiativeBonus: 100 });
    const follower = biter('follower', [], { initiativeBonus: 50 });
    const log = run({ combatants: [hero(), knocker, follower], options: { roundCap: 2 } });
    const modes = log.flatMap((l) => (l.event.kind === 'attack' && l.event.attacker === 'follower' ? [l.event.mode] : []));
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((m) => m === 'advantage')).toBe(true);
  });

  it('a repeated save ends the condition on success, and persists on failure', () => {
    const effect = (dc: number): ConditionEffect => ({
      condition: 'frightened',
      duration: { kind: 'indefinite' },
      repeatSave: { ability: 'wis', dc },
    });
    const easy = run({ combatants: [hero(), biter('ogre', [effect(1)])], options: { roundCap: 2 } });
    expect(kinds(easy, 'repeat-save')[0]!.event).toMatchObject({ success: true });
    const hard = run({ combatants: [hero(), biter('ogre', [effect(40)])], options: { roundCap: 3 } });
    expect(kinds(hard, 'repeat-save').every((l) => l.event.kind === 'repeat-save' && !l.event.success)).toBe(true);
    expect(kinds(hard, 'repeat-save').length).toBeGreaterThanOrEqual(3);
  });

  it('a fixed-length condition ends after its rounds', () => {
    const h = hero();
    h.creature.conditions = [cond('frightened', { duration: { kind: 'rounds', n: 2 }, roundsLeft: 2 })];
    const log = run({ combatants: [h, biter('ogre', [])], options: { roundCap: 4 } });
    const ends = log.filter((l) => l.event.kind === 'condition-end' && l.event.condition === 'frightened');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.round).toBe(2); // counts down at each round start; gone at the start of round 2
  });

  it('"until the start of the source\'s next turn" ends when the source acts again', () => {
    const ogre = biter('ogre', [{ condition: 'blinded', duration: { kind: 'startOfSourceNextTurn' } }]);
    const log = run({ combatants: [hero(), ogre], options: { roundCap: 3 } });
    const firstEnd = log.findIndex((l) => l.event.kind === 'condition-end');
    expect(log[firstEnd]!.round).toBe(2);
    const e = log[firstEnd]!.event;
    expect(e.kind === 'condition-end' && e.reason).toBe('expired');
  });
});

describe('grapples', () => {
  const grab = (escapeDc: number): ConditionEffect[] => [
    { condition: 'grappled', duration: { kind: 'indefinite' }, escapeDc },
    { condition: 'restrained', duration: { kind: 'while', condition: 'grappled' } },
  ];

  it('a creature restrained by a grapple spends its action trying to escape', () => {
    const log = run({ combatants: [hero(), biter('behir', grab(40))], options: { roundCap: 4 } });
    const escapes = kinds(log, 'escape');
    expect(escapes.length).toBeGreaterThanOrEqual(3);
    expect(escapes.every((l) => l.event.kind === 'escape' && !l.event.success)).toBe(true);
    expect(log.some((l) => l.event.kind === 'attack' && l.event.attacker === 'hero')).toBe(false);
  });

  it('escaping frees the creature from the grapple and the restraint', () => {
    const log = run({ combatants: [hero(), biter('behir', grab(1))], options: { roundCap: 2 } });
    const esc = kinds(log, 'escape')[0]!;
    expect(esc.event).toMatchObject({ success: true });
    const after = log.slice(log.indexOf(esc) + 1);
    expect(after.some((l) => l.event.kind === 'condition-end' && l.event.condition === 'restrained' && l.event.reason === 'released')).toBe(true);
  });

  it('killing the grappler frees the grappled creature', () => {
    const killer = hero({ dmg: '100' });
    const behir = biter('behir', grab(40), { hp: 50, ac: 1 });
    behir.creature.kind = 'monster';
    // The hero is restrained, so give a second hero who is free to kill the behir.
    const rescuer = makeCombatant('rescuer', 'party', { toHit: 30, dmg: '100', hp: 100000, ac: 5 });
    const log = run({ combatants: [killer, rescuer, behir], options: { roundCap: 5 } });
    const released = log.filter((l) => l.event.kind === 'condition-end' && l.event.reason === 'released');
    expect(released.length).toBeGreaterThan(0);
  });
});

describe('initiative with conditions', () => {
  it('an Invisible creature rolls initiative with advantage, an Incapacitated one with disadvantage', () => {
    const invisible = makeCombatant('inv', 'party');
    invisible.creature.conditions = [cond('invisible')];
    const normal = makeCombatant('norm', 'party');
    const order = rollInitiative(scriptedRng([3, 17, 10]), [invisible, normal], false);
    expect(order.find((o) => o.fighter === invisible)!.total).toBe(17);
    expect(order[0]!.fighter).toBe(invisible);

    const stunned = makeCombatant('stun', 'party');
    stunned.creature.conditions = [cond('stunned')];
    const o2 = rollInitiative(scriptedRng([17, 3]), [stunned], false);
    expect(o2[0]!.total).toBe(3);
  });

  it('Exhaustion lowers initiative', () => {
    const tired = makeCombatant('tired', 'party');
    tired.creature.exhaustion = 3;
    expect(rollInitiative(scriptedRng([10]), [tired], false)[0]!.total).toBe(4);
  });
});
