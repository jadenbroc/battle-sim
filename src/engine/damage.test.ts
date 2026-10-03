import { describe, expect, it } from 'vitest';
import { adjustAll, adjustDamage, rollDamage } from './damage';
import { scriptedRng } from './testUtil';
import type { Defenses } from './types';

const none: Defenses = { resistances: [], vulnerabilities: [], immunities: [] };

describe('adjustDamage', () => {
  it('passes damage through with no defenses', () => {
    expect(adjustDamage({ type: 'fire', amount: 9 }, none)).toMatchObject({ final: 9, effect: 'normal' });
  });

  it('halves on resistance, rounding down', () => {
    const d: Defenses = { ...none, resistances: ['fire'] };
    expect(adjustDamage({ type: 'fire', amount: 9 }, d)).toMatchObject({ final: 4, effect: 'resisted' });
  });

  it('doubles on vulnerability', () => {
    const d: Defenses = { ...none, vulnerabilities: ['fire'] };
    expect(adjustDamage({ type: 'fire', amount: 9 }, d)).toMatchObject({ final: 18, effect: 'vulnerable' });
  });

  it('zeroes on immunity, even with resistance and vulnerability', () => {
    const d: Defenses = { resistances: ['fire'], vulnerabilities: ['fire'], immunities: ['fire'] };
    expect(adjustDamage({ type: 'fire', amount: 9 }, d)).toMatchObject({ final: 0, effect: 'immune' });
  });

  it('applies resistance then vulnerability when both are present', () => {
    const d: Defenses = { ...none, resistances: ['fire'], vulnerabilities: ['fire'] };
    // 9 -> 4 (resist, round down) -> 8 (vulnerable)
    expect(adjustDamage({ type: 'fire', amount: 9 }, d)).toMatchObject({ final: 8, effect: 'normal' });
  });

  it('halves for a save before resistance, rounding down each step', () => {
    const d: Defenses = { ...none, resistances: ['fire'] };
    // 15 -> 7 (save) -> 3 (resist)
    expect(adjustDamage({ type: 'fire', amount: 15 }, d, { halve: true }).final).toBe(3);
  });

  it('only affects the matching damage type', () => {
    const d: Defenses = { ...none, resistances: ['fire'] };
    expect(adjustDamage({ type: 'cold', amount: 10 }, d).final).toBe(10);
  });
});

describe('adjustAll', () => {
  it('adjusts each type separately and sums', () => {
    const d: Defenses = { ...none, resistances: ['slashing'], immunities: ['poison'] };
    const { parts, total } = adjustAll(
      [
        { type: 'slashing', amount: 10 },
        { type: 'poison', amount: 7 },
        { type: 'fire', amount: 3 },
      ],
      d,
    );
    expect(parts.map((p) => p.final)).toEqual([5, 0, 3]);
    expect(total).toBe(8);
  });
});

describe('rollDamage', () => {
  it('rolls each component with its type', () => {
    const rolled = rollDamage(scriptedRng([4, 3]), [
      { dice: '1d8+2', type: 'slashing' },
      { dice: '1d6', type: 'fire' },
    ]);
    expect(rolled).toEqual([
      { type: 'slashing', amount: 6 },
      { type: 'fire', amount: 3 },
    ]);
  });

  it('doubles dice but not the modifier on a crit', () => {
    const rolled = rollDamage(scriptedRng([4, 5]), [{ dice: '1d8+2', type: 'slashing' }], { crit: true });
    expect(rolled[0]!.amount).toBe(4 + 5 + 2);
  });

  it('never goes below 0', () => {
    expect(rollDamage(scriptedRng([1]), [{ dice: '1d4-5', type: 'bludgeoning' }])[0]!.amount).toBe(0);
  });
});
