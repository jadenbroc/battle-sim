import { describe, expect, it } from 'vitest';
import {
  classifyActions,
  damageAverageProblems,
  damageTypes,
  parseDamage,
  parseMultiattack,
  parseUseLimit,
  requiresTargetCondition,
  splitLimit,
} from './parseMonster';

const classify = (entries: [string, string][]) => classifyActions(entries.map(([name, text]) => ({ name, text })), []);

describe('splitLimit', () => {
  it('separates usage limits from names', () => {
    expect(splitLimit('Fire Breath (Recharge 5–6)')).toEqual({ base: 'Fire Breath', limit: 'Recharge 5-6' });
    expect(splitLimit('Misty Step (3/Day)')).toEqual({ base: 'Misty Step', limit: '3/Day' });
    expect(splitLimit('Claw')).toEqual({ base: 'Claw' });
    expect(splitLimit('Frightful Presence (Costs 2 Actions)')).toEqual({ base: 'Frightful Presence (Costs 2 Actions)' });
  });
});

describe('parseUseLimit', () => {
  it('reads recharge, per-day and rest limits', () => {
    expect(parseUseLimit('Recharge 5-6')).toEqual({ kind: 'recharge', min: 5 });
    expect(parseUseLimit('Recharge 6')).toEqual({ kind: 'recharge', min: 6 });
    expect(parseUseLimit('3/Day')).toEqual({ kind: 'perDay', uses: 3 });
    expect(parseUseLimit('Recharges after a Short or Long Rest')).toEqual({ kind: 'perDay', uses: 1 });
  });

  it('returns undefined for limits it does not understand', () => {
    expect(parseUseLimit('1/Day; Requires Soul Bag')).toBeUndefined();
    expect(parseUseLimit('Costs 2 Actions')).toBeUndefined();
  });
});

describe('requiresTargetCondition', () => {
  it('spots actions that need a prone or grappled target', () => {
    expect(requiresTargetCondition('Dexterity Saving Throw: DC 16, one creature within 5 feet that has the Prone condition. Failure: 17 (2d10 + 6) Bludgeoning damage.')).toBe(true);
    expect(requiresTargetCondition('Dexterity Saving Throw: DC 18, one Large or smaller creature Grappled by the behir. Failure: swallowed')).toBe(true);
  });

  it('ignores optional conditions in parentheses', () => {
    expect(requiresTargetCondition('Melee Attack Roll: +5 (with Advantage if the target is Grappled by the ankheg), reach 5 ft. Hit: 10 (2d6 + 3) Slashing damage.')).toBe(false);
  });

  it('ignores conditions that are only inflicted', () => {
    expect(requiresTargetCondition('Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Piercing damage. The target has the Prone condition.')).toBe(false);
    expect(requiresTargetCondition('Strength Saving Throw: DC 14. Failure: 7 (1d6 + 4) Bludgeoning damage, and the target has the Prone condition.')).toBe(false);
  });
});

describe('parseDamage', () => {
  it('reads dice and type', () => {
    expect(parseDamage('Hit: 5 (1d6 + 2) Slashing damage.')).toEqual([{ dice: '1d6+2', type: 'slashing' }]);
  });

  it('chains "plus" components', () => {
    expect(parseDamage('13 (1d10 + 8) Slashing damage plus 5 (2d4) Fire damage.')).toEqual([
      { dice: '1d10+8', type: 'slashing' },
      { dice: '2d4', type: 'fire' },
    ]);
  });

  it('skips conditional extras', () => {
    expect(parseDamage('5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.')).toEqual([
      { dice: '1d6+2', type: 'slashing' },
    ]);
  });

  it('ignores versatile alternatives after "or"', () => {
    expect(parseDamage('7 (1d8 + 3) Slashing damage, or 8 (1d10 + 3) Slashing damage if used with two hands.')).toEqual([
      { dice: '1d8+3', type: 'slashing' },
    ]);
  });

  it('does not count riders in later sentences', () => {
    expect(parseDamage('7 (1d8) Piercing damage. The target takes 9 (2d8) Poison damage if it fails a save.')).toEqual([
      { dice: '1d8', type: 'piercing' },
    ]);
  });

  it('reads flat damage', () => {
    expect(parseDamage('1 Piercing damage.')).toEqual([{ dice: '1', type: 'piercing' }]);
  });

  it('handles typographic minus signs', () => {
    expect(parseDamage('3 (1d4 − 1) Bludgeoning damage')).toEqual([{ dice: '1d4-1', type: 'bludgeoning' }]);
  });
});

describe('damageAverageProblems', () => {
  it('accepts averages that match the dice and flags ones that do not', () => {
    expect(damageAverageProblems('Hit: 5 (1d6 + 2) Slashing damage plus 4 (1d8) Fire damage.')).toEqual([]);
    expect(damageAverageProblems('Hit: 9 (1d6 + 2) Slashing damage.')).toEqual(['9 (1d6 + 2) should average 5']);
  });
});

describe('parseMultiattack', () => {
  it('reads a single repeated attack', () => {
    expect(parseMultiattack('The owlbear makes two Rend attacks.')).toEqual([{ action: 'Rend', count: 2 }]);
  });

  it('reads mixed attacks', () => {
    expect(parseMultiattack('The beast makes two Claw attacks and one Bite attack.')).toEqual([
      { action: 'Claw', count: 2 },
      { action: 'Bite', count: 1 },
    ]);
  });

  it('reads "any combination" as a choice between options', () => {
    expect(parseMultiattack('The knight makes two attacks, using Greatsword or Heavy Crossbow in any combination.')).toEqual([
      { action: 'Greatsword', count: 2, options: ['Greatsword', 'Heavy Crossbow'] },
    ]);
    expect(parseMultiattack('The scout makes two attacks, using Shortsword and Longbow in any combination.')[0]!.options).toEqual([
      'Shortsword',
      'Longbow',
    ]);
  });

  it('reads "N A or B attacks" as a choice between options', () => {
    expect(parseMultiattack('The veteran makes two Greatsword or Heavy Crossbow attacks.')).toEqual([
      { action: 'Greatsword', count: 2, options: ['Greatsword', 'Heavy Crossbow'] },
    ]);
  });

  it('ignores optional swaps in later sentences', () => {
    expect(parseMultiattack('The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting.')).toEqual([
      { action: 'Rend', count: 3 },
    ]);
  });
});

describe('damageTypes', () => {
  it('reads plain damage types and notes qualified ones', () => {
    const notes: string[] = [];
    expect(damageTypes(['Fire', 'Cold, Poison'], 'Resistance', notes)).toEqual(['fire', 'cold', 'poison']);
    expect(notes).toEqual([]);
    expect(damageTypes(['Bludgeoning, Piercing, and Slashing from Nonmagical Attacks'], 'Resistance', notes)).toEqual([]);
    expect(notes[0]).toMatch(/Resistance not applied/);
  });
});

describe('classifyActions', () => {
  it('parses attacks', () => {
    const r = classify([
      ['Scimitar', 'Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.'],
    ]);
    expect(r.actions).toEqual([
      { kind: 'attack', name: 'Scimitar', attack: { name: 'Scimitar', toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } },
    ]);
  });

  it('parses a recharge breath as a limited area save', () => {
    const r = classify([
      ['Fire Breath (Recharge 5–6)', 'Dexterity Saving Throw: DC 21, each creature in a 60-foot Cone. Failure: 59 (17d6) Fire damage. Success: Half damage.'],
    ]);
    expect(r.actions).toEqual([
      {
        kind: 'save',
        name: 'Fire Breath',
        area: true,
        limit: { kind: 'recharge', min: 5 },
        save: { name: 'Fire Breath', ability: 'dex', dc: 21, halfOnSave: true, damage: [{ dice: '17d6', type: 'fire' }] },
      },
    ]);
  });

  it('treats a save that negates on success as halfOnSave false, single-target when no area is named', () => {
    const r = classify([['Spit', 'Constitution Saving Throw: DC 12, one creature the monster can see. Failure: 7 (2d6) Acid damage. Success: No damage.']]);
    const a = r.actions[0]!;
    expect(a.kind === 'save' && a.save.halfOnSave).toBe(false);
    expect(a.kind === 'save' && a.area).toBeUndefined();
  });

  it('sends spellcasting and effect-only actions to otherActions', () => {
    const r = classify([
      ['Spellcasting', 'The mage casts one of the following spells (spell save DC 14): At Will: Light.'],
      ['Frighten', 'Wisdom Saving Throw: DC 14, one creature. Failure: The target is Frightened for 1 minute.'],
    ]);
    expect(r.actions).toEqual([]);
    expect(r.otherActions.map((f) => f.name)).toEqual(['Spellcasting', 'Frighten']);
  });

  it('flags bonus actions and keeps a multiattack out of the bonus slot', () => {
    const r = classifyActions(
      [
        { name: 'Horror Nimbus (Recharge 5–6)', text: 'Wisdom Saving Throw: DC 15, each creature in a 15-foot Emanation. Failure: 28 (8d6) Psychic damage, and the target has the Frightened condition.' },
        { name: 'Multiattack', text: 'The thing makes two Claw attacks.' },
      ],
      [],
      { bonus: true },
    );
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ name: 'Horror Nimbus', bonus: true, limit: { kind: 'recharge', min: 5 } });
    expect(r.multiattack).toBeUndefined();
  });

  it('leaves actions that need a prone target, or have an unknown limit, unsimulated', () => {
    const r = classify([
      ['Trample', 'Dexterity Saving Throw: DC 16, one creature within 5 feet that has the Prone condition. Failure: 17 (2d10 + 6) Bludgeoning damage. Success: Half damage.'],
      ['Haunting (1/Day; Requires Soul Bag)', 'Wisdom Saving Throw: DC 15, one creature. Failure: 10 (3d6) Psychic damage.'],
    ]);
    expect(r.actions).toEqual([]);
    expect(r.otherActions.map((f) => f.name)).toEqual(['Trample', 'Haunting (1/Day; Requires Soul Bag)']);
  });

  it('records the multiattack separately from the actions', () => {
    const r = classify([
      ['Multiattack', 'The owlbear makes two Rend attacks.'],
      ['Rend', 'Melee Attack Roll: +7, reach 5 ft. Hit: 14 (2d8 + 5) Slashing damage.'],
    ]);
    expect(r.multiattack?.parts).toEqual([{ action: 'Rend', count: 2 }]);
    expect(r.actions.map((a) => a.name)).toEqual(['Rend']);
  });

  it('strips "Form Only" suffixes from action names and notes them', () => {
    const notes: string[] = [];
    const r = classifyActions(
      [{ name: 'Bite (Bear or Hybrid Form Only)', text: 'Melee Attack Roll: +7, reach 5 ft. Hit: 13 (2d8 + 4) Piercing damage.' }],
      notes,
    );
    expect(r.actions.map((a) => a.name)).toEqual(['Bite']);
    expect(r.actions[0]!.limit).toBeUndefined();
    expect(notes[0]).toMatch(/only usable in some forms/);
  });
});
