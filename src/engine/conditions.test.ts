import { describe, expect, it } from 'vitest';
import {
  activeNames,
  addExhaustion,
  applyCondition,
  attackFlags,
  canAct,
  canStandUp,
  cannotTarget,
  d20Penalty,
  defensesOf,
  expireAt,
  hasCondition,
  initiativeMode,
  isAutoCrit,
  releaseLinked,
  saveFlags,
  sizeAtMost,
  tickRounds,
} from './conditions';
import { makeCreature } from './testUtil';
import type { ActiveCondition, ConditionName, Creature } from './types';

const withCond = (names: ConditionName[], over: Partial<Creature> = {}): Creature =>
  makeCreature({ conditions: names.map((name): ActiveCondition => ({ name, duration: { kind: 'indefinite' } })), ...over });

describe('implied conditions', () => {
  it('Unconscious includes Incapacitated and Prone', () => {
    expect([...activeNames(withCond(['unconscious']))].sort()).toEqual(['incapacitated', 'prone', 'unconscious']);
  });

  it('Paralyzed, Petrified and Stunned include Incapacitated', () => {
    for (const n of ['paralyzed', 'petrified', 'stunned'] as const) expect(hasCondition(withCond([n]), 'incapacitated'), n).toBe(true);
  });

  it('a creature at 0 HP counts as Unconscious', () => {
    expect(hasCondition(makeCreature({ hp: 0, status: 'down' }), 'unconscious')).toBe(true);
    expect(hasCondition(makeCreature({ hp: 0, status: 'stable' }), 'unconscious')).toBe(true);
    expect(hasCondition(makeCreature(), 'unconscious')).toBe(false);
  });

  it('Incapacitated creatures cannot act, others can', () => {
    expect(canAct(makeCreature())).toBe(true);
    expect(canAct(withCond(['incapacitated']))).toBe(false);
    expect(canAct(withCond(['stunned']))).toBe(false);
    expect(canAct(withCond(['poisoned']))).toBe(true);
    expect(canAct(makeCreature({ hp: 0, status: 'down' }))).toBe(false);
  });
});

describe('attack rolls', () => {
  const plain = makeCreature({ id: 'plain' });
  const flags = (attacker: Creature, target: Creature, melee = true) => attackFlags(attacker, target, melee);

  it('no conditions, no modifiers', () => {
    expect(flags(plain, makeCreature({ id: 't' }))).toEqual({ advantage: false, disadvantage: false });
  });

  it('attacker disadvantage: Blinded, Poisoned, Prone, Restrained, Frightened', () => {
    for (const n of ['blinded', 'poisoned', 'prone', 'restrained', 'frightened'] as const) {
      expect(flags(withCond([n]), plain), n).toEqual({ advantage: false, disadvantage: true });
    }
  });

  it('attacks against Blinded, Paralyzed, Petrified, Restrained, Stunned and Unconscious targets have advantage', () => {
    for (const n of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'] as const) {
      expect(flags(plain, withCond([n])).advantage, n).toBe(true);
    }
  });

  it('Prone targets: advantage in melee, disadvantage at range', () => {
    expect(flags(plain, withCond(['prone']), true)).toEqual({ advantage: true, disadvantage: false });
    expect(flags(plain, withCond(['prone']), false)).toEqual({ advantage: false, disadvantage: true });
  });

  it('Invisible: advantage attacking, disadvantage being attacked', () => {
    expect(flags(withCond(['invisible']), plain)).toEqual({ advantage: true, disadvantage: false });
    expect(flags(plain, withCond(['invisible']))).toEqual({ advantage: false, disadvantage: true });
  });

  it('Grappled: disadvantage against anyone except the grappler', () => {
    const grappled = makeCreature({ conditions: [{ name: 'grappled', sourceId: 'ogre', duration: { kind: 'indefinite' } }] });
    expect(flags(grappled, makeCreature({ id: 'other' })).disadvantage).toBe(true);
    expect(flags(grappled, makeCreature({ id: 'ogre' })).disadvantage).toBe(false);
  });

  it('Charmed, Deafened and Exhaustion do not change advantage', () => {
    expect(flags(withCond(['charmed', 'deafened']), plain)).toEqual({ advantage: false, disadvantage: false });
  });

  it('auto-crits only for melee hits on Paralyzed or Unconscious targets', () => {
    expect(isAutoCrit(withCond(['paralyzed']), true)).toBe(true);
    expect(isAutoCrit(withCond(['unconscious']), true)).toBe(true);
    expect(isAutoCrit(makeCreature({ hp: 0, status: 'down' }), true)).toBe(true);
    expect(isAutoCrit(withCond(['paralyzed']), false)).toBe(false);
    expect(isAutoCrit(withCond(['stunned']), true)).toBe(false);
    expect(isAutoCrit(withCond(['petrified']), true)).toBe(false);
  });
});

describe('saving throws', () => {
  it('Paralyzed, Petrified, Stunned and Unconscious auto-fail Str and Dex saves only', () => {
    for (const n of ['paralyzed', 'petrified', 'stunned', 'unconscious'] as const) {
      const c = withCond([n]);
      expect(saveFlags(c, 'str').autoFail, n).toBe(true);
      expect(saveFlags(c, 'dex').autoFail, n).toBe(true);
      expect(saveFlags(c, 'con').autoFail, n).toBe(false);
      expect(saveFlags(c, 'wis').autoFail, n).toBe(false);
    }
  });

  it('Restrained has disadvantage on Dex saves only', () => {
    expect(saveFlags(withCond(['restrained']), 'dex').disadvantage).toBe(true);
    expect(saveFlags(withCond(['restrained']), 'str').disadvantage).toBe(false);
    expect(saveFlags(withCond(['restrained']), 'dex').autoFail).toBe(false);
  });
});

describe('initiative, exhaustion, defenses', () => {
  it('Invisible rolls initiative with advantage, Incapacitated with disadvantage, both cancel', () => {
    expect(initiativeMode(makeCreature())).toBe('normal');
    expect(initiativeMode(withCond(['invisible']))).toBe('advantage');
    expect(initiativeMode(withCond(['incapacitated']))).toBe('disadvantage');
    expect(initiativeMode(withCond(['invisible', 'incapacitated']))).toBe('normal');
  });

  it('exhaustion is -2 per level and level 6 is death', () => {
    const c = makeCreature();
    expect(d20Penalty(c)).toBe(0);
    addExhaustion(c, 2);
    expect(d20Penalty(c)).toBe(4);
    addExhaustion(c, 3);
    expect(c.exhaustion).toBe(5);
    expect(c.status).toBe('alive');
    addExhaustion(c);
    expect(c).toMatchObject({ exhaustion: 6, status: 'dead', hp: 0 });
    addExhaustion(c);
    expect(c.exhaustion).toBe(6);
  });

  it('Petrified creatures resist all damage', () => {
    const d = defensesOf(withCond(['petrified'], { vulnerabilities: ['fire'] }));
    expect(d.resistances).toContain('slashing');
    expect(d.resistances).toContain('psychic');
    expect(d.vulnerabilities).toEqual(['fire']);
    expect(defensesOf(makeCreature()).resistances).toEqual([]);
  });

  it('a Charmed creature cannot target its charmer', () => {
    const c = makeCreature({ conditions: [{ name: 'charmed', sourceId: 'witch', duration: { kind: 'indefinite' } }] });
    expect(cannotTarget(c, makeCreature({ id: 'witch' }))).toBe(true);
    expect(cannotTarget(c, makeCreature({ id: 'other' }))).toBe(false);
  });

  it('prone creatures can stand unless held in place', () => {
    expect(canStandUp(withCond(['prone']))).toBe(true);
    expect(canStandUp(withCond(['prone', 'restrained']))).toBe(false);
    expect(canStandUp(withCond(['prone', 'grappled']))).toBe(false);
    expect(canStandUp(withCond(['prone', 'stunned']))).toBe(true); // 2024 Stunned keeps its Speed
  });
});

describe('applyCondition', () => {
  const effect = (over = {}) => ({ condition: 'prone' as const, duration: { kind: 'indefinite' as const }, ...over });

  it('puts a condition on a creature and refreshes the same one from the same source', () => {
    const t = makeCreature();
    applyCondition(t, effect(), { sourceId: 'wolf' });
    applyCondition(t, effect(), { sourceId: 'wolf' });
    expect(t.conditions).toHaveLength(1);
    applyCondition(t, effect(), { sourceId: 'other' });
    expect(t.conditions).toHaveLength(2);
  });

  it('respects condition immunities, size limits, death, and Petrified immunity to Poisoned', () => {
    expect(applyCondition(makeCreature({ conditionImmunities: ['prone'] }), effect())).toBeNull();
    expect(applyCondition(makeCreature({ size: 'huge' }), effect({ maxSize: 'large' }))).toBeNull();
    expect(applyCondition(makeCreature({ size: 'large' }), effect({ maxSize: 'large' }))).not.toBeNull();
    expect(applyCondition(makeCreature(), effect({ maxSize: 'medium' }))).not.toBeNull(); // default size is medium
    expect(applyCondition(makeCreature({ status: 'dead' }), effect())).toBeNull();
    expect(applyCondition(withCond(['petrified']), effect({ condition: 'poisoned' }))).toBeNull();
  });

  it('orders sizes', () => {
    expect(sizeAtMost('small', 'medium')).toBe(true);
    expect(sizeAtMost('large', 'medium')).toBe(false);
    expect(sizeAtMost(undefined, 'medium')).toBe(true);
  });
});

describe('durations', () => {
  const eff = (duration: ActiveCondition['duration']) => ({ condition: 'poisoned' as const, duration });

  it('"until the end of its next turn" ends at the target\'s next turn end', () => {
    const t = makeCreature({ id: 't' });
    applyCondition(t, eff({ kind: 'endOfTargetNextTurn' }), { sourceId: 's', actorId: 's' });
    expect(expireAt([t], 's', 'end')).toHaveLength(0);
    expect(expireAt([t], 't', 'start')).toHaveLength(0);
    expect(expireAt([t], 't', 'end')).toHaveLength(1);
    expect(t.conditions).toEqual([]);
  });

  it('applied on its own turn, "its next turn" skips the current one', () => {
    const t = makeCreature({ id: 't' });
    applyCondition(t, eff({ kind: 'endOfTargetNextTurn' }), { sourceId: 's', actorId: 't' });
    expect(expireAt([t], 't', 'end')).toHaveLength(0);
    expect(expireAt([t], 't', 'end')).toHaveLength(1);
  });

  it('"until the start of the source\'s next turn" ends when the source\'s turn starts', () => {
    const t = makeCreature({ id: 't' });
    applyCondition(t, eff({ kind: 'startOfSourceNextTurn' }), { sourceId: 's', actorId: 's' });
    expect(expireAt([t], 's', 'end')).toHaveLength(0);
    expect(expireAt([t], 's', 'start')).toHaveLength(1);
  });

  it('"until the end of the source\'s next turn" skips the source\'s current turn', () => {
    const t = makeCreature({ id: 't' });
    applyCondition(t, eff({ kind: 'endOfSourceNextTurn' }), { sourceId: 's', actorId: 's' });
    expect(expireAt([t], 's', 'end')).toHaveLength(0);
    expect(expireAt([t], 's', 'end')).toHaveLength(1);
  });

  it('round-based conditions count down at the start of each round', () => {
    const t = makeCreature();
    applyCondition(t, eff({ kind: 'rounds', n: 3 }));
    expect(tickRounds([t])).toHaveLength(0);
    expect(tickRounds([t])).toHaveLength(0);
    expect(tickRounds([t])).toHaveLength(1);
  });
});

describe('releaseLinked', () => {
  const setup = () => {
    const grappler = makeCreature({ id: 'ogre' });
    const victim = makeCreature({ id: 'v' });
    applyCondition(victim, { condition: 'grappled', duration: { kind: 'indefinite' }, escapeDc: 13 }, { sourceId: 'ogre' });
    applyCondition(victim, { condition: 'restrained', duration: { kind: 'while', condition: 'grappled' } }, { sourceId: 'ogre' });
    return { grappler, victim };
  };

  it('keeps the grapple while the grappler is active', () => {
    const { grappler, victim } = setup();
    expect(releaseLinked([grappler, victim])).toHaveLength(0);
    expect(victim.conditions).toHaveLength(2);
  });

  it('ends the grapple, and the restraint that came with it, when the grappler dies', () => {
    const { grappler, victim } = setup();
    grappler.status = 'dead';
    expect(releaseLinked([grappler, victim])).toHaveLength(2);
    expect(victim.conditions).toEqual([]);
  });

  it('ends the grapple when the grappler is incapacitated', () => {
    const { grappler, victim } = setup();
    grappler.conditions = [{ name: 'stunned', duration: { kind: 'indefinite' } }];
    releaseLinked([grappler, victim]);
    expect(victim.conditions).toEqual([]);
  });
});
