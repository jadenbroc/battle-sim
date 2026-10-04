import { describe, expect, it } from 'vitest';
import { parseArea, parseScaling, parseSpellBlock, parseSpellDamage, splitSpellBlocks } from './parseSpell';

/** Build a spell block in the SRD markdown format. */
function block(
  name: string,
  header: string,
  body: string,
  over: { castingTime?: string; duration?: string; range?: string } = {},
): string[] {
  return [
    `#### ${name}`,
    '',
    `_${header}_`,
    '',
    `**Casting Time:** ${over.castingTime ?? 'Action'}`,
    `**Range:** ${over.range ?? '120 feet'}`,
    '**Components:** V, S',
    `**Duration:** ${over.duration ?? 'Instantaneous'}`,
    '',
    ...body.split('\n'),
  ];
}

const parse = (...args: Parameters<typeof block>) => parseSpellBlock(block(...args));

describe('splitSpellBlocks', () => {
  it('finds spells and ignores other headings', () => {
    const md = ['## Spell Descriptions', '', ...block('Fire Bolt', 'Evocation Cantrip (Sorcerer, Wizard)', 'Text.'), '', '#### Not a spell', '', 'Just text.', '', ...block('Fireball', 'Level 3 Evocation (Wizard)', 'Text.')];
    expect(splitSpellBlocks(md).map((b) => b[0])).toEqual(['#### Fire Bolt', '#### Fireball']);
  });
});

describe('parseSpellDamage', () => {
  it('reads dice, modifiers and types', () => {
    expect(parseSpellDamage('takes 8d6 Fire damage on a failed save')).toEqual([{ dice: '8d6', type: 'fire' }]);
    expect(parseSpellDamage('A dart deals 1d4 + 1 Force damage')).toEqual([{ dice: '1d4+1', type: 'force' }]);
    expect(parseSpellDamage('takes 10d6 + 40 Force damage')).toEqual([{ dice: '10d6+40', type: 'force' }]);
  });

  it('chains "and" components', () => {
    expect(parseSpellDamage('takes 5d6 Fire damage and 5d6 Radiant damage')).toEqual([
      { dice: '5d6', type: 'fire' },
      { dice: '5d6', type: 'radiant' },
    ]);
  });

  it('stops at delayed or separate extra damage', () => {
    expect(parseSpellDamage('takes 4d4 Acid damage and 2d4 Acid damage at the end of its next turn')).toEqual([{ dice: '4d4', type: 'acid' }]);
    expect(parseSpellDamage('takes 10d4 Acid damage and another 5d4 Acid damage at the end of its next turn')).toEqual([{ dice: '10d4', type: 'acid' }]);
  });
});

describe('parseArea', () => {
  it('reads shapes and sizes', () => {
    expect(parseArea('Each creature in a 20-foot-radius Sphere')).toEqual({ shape: 'sphere', size: 20 });
    expect(parseArea('a 15-foot Cone')).toEqual({ shape: 'cone', size: 15 });
    expect(parseArea('a 100-foot-long, 5-foot-wide Line')).toEqual({ shape: 'line', size: 100 });
    expect(parseArea('a 10-foot Emanation')).toEqual({ shape: 'emanation', size: 10 });
    expect(parseArea('a single creature')).toBeUndefined();
  });
});

describe('parseScaling', () => {
  it('reads upcast damage, healing and extra projectiles', () => {
    const n: string[] = [];
    expect(parseScaling('The damage increases by 1d6 for each spell slot level above 3.', undefined, n)).toEqual({ upcast: { above: 3, damageDice: '1d6' } });
    expect(parseScaling('The healing increases by 2d8 for each spell slot level above 1.', undefined, n)).toEqual({ upcast: { above: 1, healDice: '2d8' } });
    expect(parseScaling('The spell creates one more dart for each spell slot level above 1.', undefined, n)).toEqual({ upcast: { above: 1, count: 1 } });
    expect(parseScaling('You create one additional ray for each spell slot level above 2.', undefined, n)).toEqual({ upcast: { above: 2, count: 1 } });
    expect(n).toEqual([]);
  });

  it('reads cantrip upgrades', () => {
    const n: string[] = [];
    expect(parseScaling(undefined, 'The damage increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10).', n)).toEqual({ cantrip: { damageDice: '1d10' } });
    expect(parseScaling(undefined, 'The spell creates two beams at level 5, three beams at level 11, and four beams at level 17.', n)).toEqual({ cantrip: { counts: [1, 2, 3, 4] } });
    expect(parseScaling(undefined, 'The range doubles when you reach levels 5 (240 feet), 11 (480 feet), and 17 (960 feet).', n)).toBeUndefined();
    expect(n).toEqual([]);
  });

  it('notes scaling it cannot simulate', () => {
    const n: string[] = [];
    parseScaling('The duration increases by 1 hour for each spell slot level above 2.', undefined, n);
    expect(n[0]).toMatch(/Higher-level effect not simulated/);
  });
});

describe('parseSpellBlock', () => {
  it('reads the header fields', () => {
    const { def, problems } = parse('Fireball', 'Level 3 Evocation (Sorcerer, Wizard)', 'Each creature in a 20-foot-radius Sphere makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save or half as much damage on a successful one.', { range: '150 feet' });
    expect(problems).toEqual([]);
    expect(def).toMatchObject({ id: 'fireball', name: 'Fireball', level: 3, school: 'Evocation', classes: ['Sorcerer', 'Wizard'], castingTime: 'Action', range: '150 feet', concentration: false });
  });

  it('reads a cantrip header, concentration and ritual', () => {
    expect(parse('Fire Bolt', 'Evocation Cantrip (Sorcerer, Wizard)', 'Make a ranged spell attack. On a hit, the target takes 1d10 Fire damage.').def).toMatchObject({ level: 0, school: 'Evocation' });
    expect(parse('Hold Person', 'Level 2 Enchantment (Wizard)', 'x', { duration: 'Concentration, up to 1 minute' }).def.concentration).toBe(true);
    expect(parse('Detect Magic', 'Level 1 Divination (Wizard)', 'x', { castingTime: 'Action or Ritual' }).def.ritual).toBe(true);
  });

  it('accepts the "Component:" spelling used by some spells in the source', () => {
    const lines = block('Barkskin', 'Level 2 Transmutation (Druid)', 'x').map((l) => l.replace('**Components:**', '**Component:**'));
    expect(parseSpellBlock(lines).problems).toEqual([]);
  });

  it('parses a spell attack, with cantrip scaling', () => {
    const { def } = parse(
      'Fire Bolt',
      'Evocation Cantrip (Sorcerer, Wizard)',
      'You hurl a mote of fire. Make a ranged spell attack against the target. On a hit, the target takes 1d10 Fire damage.\n\n_Cantrip Upgrade._ The damage increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10).',
    );
    expect(def.effect).toEqual({ kind: 'attack', range: 'ranged', damage: [{ dice: '1d10', type: 'fire' }], scaling: { cantrip: { damageDice: '1d10' } } });
    expect(def.text).not.toContain('Cantrip Upgrade');
    expect(def.cantripUpgrade).toMatch(/1d10 when you reach/);
  });

  it('parses multiple rays and their upcast', () => {
    const { def } = parse(
      'Scorching Ray',
      'Level 2 Evocation (Sorcerer, Wizard)',
      'You hurl three fiery rays. Make a ranged spell attack for each ray. On a hit, the target takes 2d6 Fire damage.\n\n_Using a Higher-Level Spell Slot._ You create one additional ray for each spell slot level above 2.',
    );
    expect(def.effect).toMatchObject({ kind: 'attack', count: 3, damage: [{ dice: '2d6', type: 'fire' }], scaling: { upcast: { above: 2, count: 1 } } });
  });

  it('parses Magic Missile as auto-hit darts', () => {
    const { def } = parse(
      'Magic Missile',
      'Level 1 Evocation (Sorcerer, Wizard)',
      'You create three glowing darts of magical force. Each dart strikes a creature of your choice. A dart deals 1d4 + 1 Force damage to its target.\n\n_Using a Higher-Level Spell Slot._ The spell creates one more dart for each spell slot level above 1.',
    );
    expect(def.effect).toEqual({ kind: 'attack', range: 'ranged', autoHit: true, count: 3, damage: [{ dice: '1d4+1', type: 'force' }], scaling: { upcast: { above: 1, count: 1 } } });
  });

  it('parses a save spell with an area and half damage', () => {
    const { def } = parse('Fireball', 'Level 3 Evocation (Wizard)', 'Each creature in a 20-foot-radius Sphere makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save or half as much damage on a successful one.');
    expect(def.effect).toEqual({ kind: 'save', ability: 'dex', damage: [{ dice: '8d6', type: 'fire' }], halfOnSave: true, area: { shape: 'sphere', size: 20 } });
  });

  it('parses a save spell whose damage is in the next sentence', () => {
    const { def } = parse('Vitriolic Sphere', 'Level 4 Evocation (Sorcerer, Wizard)', 'Each creature in that area makes a Dexterity saving throw. On a failed save, a creature takes 10d4 Acid damage and another 5d4 Acid damage at the end of its next turn. On a successful save, a creature takes half the initial damage only. A 20-foot-radius Sphere.');
    expect(def.effect).toMatchObject({ kind: 'save', damage: [{ dice: '10d4', type: 'acid' }], halfOnSave: true });
    expect(def.notes.join(' ')).toMatch(/Repeated or delayed damage/);
  });

  it('parses a single-target save without half damage, and has no area', () => {
    const { def } = parse('Sacred Flame', 'Evocation Cantrip (Cleric)', 'The target must succeed on a Dexterity saving throw or take 1d8 Radiant damage.');
    expect(def.effect).toEqual({ kind: 'save', ability: 'dex', damage: [{ dice: '1d8', type: 'radiant' }], halfOnSave: false });
  });

  it('parses a condition spell with a repeated save', () => {
    const { def } = parse(
      'Hold Person',
      'Level 2 Enchantment (Wizard)',
      'Choose a Humanoid that you can see. The target must succeed on a Wisdom saving throw or have the Paralyzed condition for the duration. At the end of each of its turns, the target repeats the save, ending the spell on itself on a success.',
      { duration: 'Concentration, up to 1 minute' },
    );
    expect(def.effect).toMatchObject({
      kind: 'save',
      ability: 'wis',
      damage: [],
      effects: [{ condition: 'paralyzed', duration: { kind: 'rounds', n: 10 }, repeatSave: { ability: 'wis', dc: 0 } }],
    });
    expect(def.notes).not.toContain('Concentration is not modelled');
  });

  it('parses healing spells', () => {
    expect(parse('Cure Wounds', 'Level 1 Abjuration (Cleric)', 'A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier.\n\n_Using a Higher-Level Spell Slot._ The healing increases by 2d8 for each spell slot level above 1.').def.effect).toEqual({
      kind: 'heal',
      dice: '2d8',
      addsModifier: true,
      scaling: { upcast: { above: 1, healDice: '2d8' } },
    });
    expect(parse('Heal', 'Level 6 Evocation (Cleric)', 'Positive energy washes through the target, restoring 70 Hit Points.').def.effect).toEqual({ kind: 'heal', dice: '70', addsModifier: false });
  });

  it('keeps only the initial damage of a spell that also damages later', () => {
    const { def } = parse('Acid Arrow', 'Level 2 Evocation (Wizard)', 'Make a ranged spell attack against the target. On a hit, the target takes 4d4 Acid damage and 2d4 Acid damage at the end of its next turn.');
    expect((def.effect as { damage: unknown[] }).damage).toEqual([{ dice: '4d4', type: 'acid' }]);
  });
});

describe('spells the simulator leaves out', () => {
  const none = (name: string, header: string, body: string, over = {}) => {
    const { def } = parse(name, header, body, over);
    expect(def.effect, name).toBeUndefined();
    return def.notes.join(' ');
  };

  it('skips reactions and long casting times', () => {
    expect(none('Hellish Rebuke', 'Level 1 Evocation (Warlock)', 'The creature makes a Dexterity saving throw, taking 2d10 Fire damage.', { castingTime: 'Reaction, which you take in response to damage' })).toMatch(/Casting time/);
    expect(none('Symbol', 'Level 7 Abjuration (Wizard)', 'A Dexterity saving throw, taking 10d10 Fire damage.', { castingTime: '1 minute' })).toMatch(/Casting time/);
  });

  it('skips zones that act when creatures enter or end their turns', () => {
    expect(none('Spirit Guardians', 'Level 3 Conjuration (Cleric)', 'A creature that enters the area or ends its turn there makes a Wisdom saving throw, taking 3d8 Radiant damage.', { duration: 'Concentration, up to 10 minutes' })).toMatch(/Zone/);
  });

  it('skips smites, summons, walls, menus, tables and willing-target buffs', () => {
    expect(none('Searing Smite', 'Level 1 Evocation (Paladin)', 'The next time you hit with a weapon, the target takes 1d6 Fire damage.', { castingTime: 'Bonus Action' })).toMatch(/smite/i);
    expect(none('Conjure Elemental', 'Level 5 Conjuration (Druid)', 'A creature makes a Dexterity saving throw, taking 8d6 Fire damage.')).toMatch(/Summon/);
    expect(none('Wall of Fire', 'Level 4 Evocation (Wizard)', 'A creature makes a Dexterity saving throw, taking 5d8 Fire damage.')).toMatch(/wall/i);
    expect(none('Eyebite', 'Level 6 Necromancy (Wizard)', 'Choose one of the following effects. The target makes a Wisdom saving throw or has the Frightened condition.')).toMatch(/menu/);
    expect(none('Prismatic Spray', 'Level 7 Evocation (Wizard)', 'Each creature makes a Dexterity saving throw. <table> <tr><td>1</td><td>12d6 Fire damage</td></tr></table>')).toMatch(/menu or table/);
    expect(none('Haste', 'Level 3 Transmutation (Wizard)', 'Choose a willing creature that you can see. When the spell ends, the target has the Incapacitated condition. Wisdom saving throw.', { duration: 'Concentration, up to 1 minute' })).toMatch(/willing/);
  });

  it('skips concentration spells you keep using on later turns', () => {
    expect(none('Call Lightning', 'Level 3 Conjuration (Druid)', 'Each creature makes a Dexterity saving throw, taking 3d10 Lightning damage. Until the spell ends, you can take a Magic action to call down lightning again.', { duration: 'Concentration, up to 10 minutes' })).toMatch(/Controlled or repeating/);
  });

  it('keeps a non-concentration cantrip that can be thrown again', () => {
    const { def } = parse('Produce Flame', 'Conjuration Cantrip (Druid)', 'Until the spell ends, you can take a Magic action to hurl the flame. Make a ranged spell attack. On a hit, the target takes 1d8 Fire damage.', { duration: '10 minutes' });
    expect(def.effect?.kind).toBe('attack');
  });

  it('notes a save effect it cannot read', () => {
    expect(none('Bestow Curse', 'Level 3 Necromancy (Wizard)', 'You touch a creature, which must succeed on a Wisdom saving throw or become cursed for the duration.', { duration: 'Concentration, up to 1 minute' })).toMatch(/not simulated/);
  });
});
