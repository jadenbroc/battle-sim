import { describe, expect, it } from 'vitest';
import { runFight } from './fight';
import { createRng } from './rng';
import { expectedAttackDamage, planTurn } from './tactics';
import { makeCombatant, makeCreature, scriptedRng } from './testUtil';
import type { Action, ActiveCondition, Combatant, ConditionName, Creature } from './types';

const withCond = (names: ConditionName[], over: Partial<Creature> = {}): Creature =>
  makeCreature({ conditions: names.map((name): ActiveCondition => ({ name, duration: { kind: 'indefinite' } })), ...over });

const trample: Action = {
  kind: 'save',
  name: 'Trample',
  bonus: true,
  targetRequires: 'prone',
  save: { name: 'Trample', ability: 'dex', dc: 16, halfOnSave: true, damage: [{ dice: '2d10+6', type: 'bludgeoning' }] },
};
const gore: Action = {
  kind: 'attack',
  name: 'Gore',
  attack: {
    name: 'Gore',
    toHit: 30,
    damage: [{ dice: '1', type: 'piercing' }],
    effects: [{ condition: 'prone', duration: { kind: 'indefinite' } }],
  },
};

describe('actions that need a target in some condition', () => {
  const rng = scriptedRng([]);

  it('are not planned while no target has the condition', () => {
    const elephant = makeCombatant('elephant', 'enemies', { actions: [trample] });
    const hero = makeCombatant('hero', 'party');
    expect(planTurn(elephant, [elephant, hero], rng, 3, 'bonus')).toBeNull();
  });

  it('are planned against a target that has it', () => {
    const elephant = makeCombatant('elephant', 'enemies', { actions: [trample] });
    const standing = makeCombatant('standing', 'party');
    const prone = makeCombatant('prone', 'party');
    prone.creature.conditions = [{ name: 'prone', duration: { kind: 'indefinite' } }];
    const plan = planTurn(elephant, [elephant, standing, prone], rng, 3, 'bonus');
    expect(plan?.kind === 'save' && plan.targets[0]!.creature.id).toBe(prone.creature.id);
  });

  it('combine in a fight: the gore knocks the hero prone, then the trample hits the prone hero', () => {
    const elephant = makeCombatant('elephant', 'enemies', { hp: 100000, ac: 30, initiativeBonus: 100, actions: [gore, trample] });
    const hero = makeCombatant('hero', 'party', { dmg: '0', toHit: 30, hp: 100000, ac: 5 });
    const r = runFight({ combatants: [hero, elephant], options: { roundCap: 1 } }, createRng('trample'), { log: true });
    const options = r.log.flatMap((l) => {
      const e = l.event;
      if (e.kind === 'attack' && e.attacker === 'elephant') return [e.option];
      if (e.kind === 'save' && e.caster === 'elephant') return [e.option];
      return [];
    });
    expect(options).toEqual(['Gore', 'Trample']);
  });
});

describe('action choice and conditions', () => {
  it('chooses by expected damage, not by the conditions an action would inflict', () => {
    // Simulation showed that a Ghoul clawing for paralysis instead of biting plays worse.
    const ghoul = makeCombatant('ghoul', 'enemies');
    const claw: Action = {
      kind: 'attack',
      name: 'Claw',
      attack: { name: 'Claw', toHit: 5, damage: [{ dice: '1d4+2', type: 'slashing' }], effects: [{ condition: 'paralyzed', duration: { kind: 'endOfTargetNextTurn' } }] },
    };
    const bite: Action = { kind: 'attack', name: 'Bite', attack: { name: 'Bite', toHit: 5, damage: [{ dice: '2d6+3', type: 'piercing' }] } };
    ghoul.actions = [claw, bite];
    const plan = planTurn(ghoul, [ghoul, makeCombatant('hero', 'party')], scriptedRng([]), 3);
    expect(plan?.kind === 'attack' && plan.action.name).toBe('Bite');
  });

  it('expected damage reflects advantage against a prone target', () => {
    const a = { name: 'Bite', toHit: 5, damage: [{ dice: '1d8+3', type: 'piercing' as const }] };
    const plain = expectedAttackDamage(a, makeCreature({ ac: 15 }), makeCreature());
    const vsProne = expectedAttackDamage(a, withCond(['prone'], { ac: 15 }), makeCreature());
    expect(vsProne).toBeGreaterThan(plain);
    const ranged = expectedAttackDamage({ ...a, range: 'ranged' }, withCond(['prone'], { ac: 15 }), makeCreature());
    expect(ranged).toBeLessThan(plain);
  });

  it('expected damage counts automatic crits on a paralyzed target', () => {
    const a = { name: 'Bite', toHit: 5, damage: [{ dice: '2d6', type: 'piercing' as const }] };
    const normal = expectedAttackDamage(a, makeCreature({ ac: 15 }), makeCreature());
    const paralyzed = expectedAttackDamage(a, withCond(['paralyzed'], { ac: 15 }), makeCreature());
    expect(paralyzed).toBeGreaterThan(normal * 1.8); // advantage plus every hit a crit
  });
});

describe('Charmed targeting in planning', () => {
  it('never plans an attack on the charmer', () => {
    const hero = makeCombatant('hero', 'party');
    hero.creature.conditions = [{ name: 'charmed', sourceId: 'witch', duration: { kind: 'indefinite' } }];
    const witch = makeCombatant('witch', 'enemies', { hp: 1 }); // the weakest, so it would normally be chosen
    const goon = makeCombatant('goon', 'enemies', { hp: 50 });
    const plan = planTurn(hero as Combatant, [hero, witch, goon], scriptedRng([]), 3);
    expect(plan?.kind === 'attack' && plan.target.creature.id).toBe('goon');
  });
});
