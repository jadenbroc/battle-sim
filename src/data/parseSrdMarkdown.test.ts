import { describe, expect, it } from 'vitest';
import { parseSrdBlock, slugify, splitBlocks } from './parseSrdMarkdown';

const table = (rows: [string, number, string, string][]): string =>
  `<table><tbody><tr>${rows.map(([ab, score, mod, save]) => `<td><strong>${ab}</strong></td><td>${score}</td><td>${mod}</td><td>${save}</td>`).join('')}</tr></tbody></table>`;

const GOBLIN = `### Goblin Warrior

_Small Fey (Goblinoid), Chaotic Neutral_

**AC** 15 **Initiative** +2 (12) <br>
**HP** 10 (3d6) <br>
**Speed** 30 ft. <br>

${table([
  ['STR', 8, '−1', '−1'],
  ['DEX', 15, '+2', '+2'],
  ['CON', 10, '+0', '+0'],
  ['INT', 10, '+0', '+0'],
  ['WIS', 8, '−1', '−1'],
  ['CHA', 8, '−1', '−1'],
])}

**Skills** Stealth +6<br>
**Senses** Darkvision 60 ft.; Passive Perception 9<br>
**Languages** Common, Goblin<br>
**CR** 1/4 (XP 50; PB +2)

#### Actions

**_Scimitar._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.

#### Bonus Actions

**_Nimble Escape._** The goblin takes the Disengage or Hide action.
`;

const DRAGON = `## Dragons

### Adult Red Dragon

_Huge Dragon (Chromatic), Chaotic Evil_

**AC** 19 **Initiative** +12 (22) <br>
**HP** 256 (19d12 + 133) <br>
**Speed** 40 ft., Climb 40 ft., Fly 80 ft. <br>

${table([
  ['STR', 27, '+8', '+8'],
  ['DEX', 10, '+0', '+6'],
  ['CON', 25, '+7', '+7'],
  ['INT', 16, '+3', '+3'],
  ['WIS', 13, '+1', '+7'],
  ['CHA', 23, '+6', '+6'],
])}

**Resistances** Cold<br>
**Immunities** Fire; Charmed<br>
**CR** 17 (XP 18,000, or 20,000 in lair; PB +6)

#### Traits

**_Legendary Resistance (3/Day, or 4/Day in Lair)._** If the dragon fails a saving throw, it can choose to succeed instead.

#### Actions

**_Multiattack._** The dragon makes three Rend attacks.

**_Rend._** _Melee Attack Roll:_ +14, reach 10 ft. _Hit:_ 13 (1d10 + 8) Slashing damage plus 5 (2d4) Fire damage.

**_Fire Breath (Recharge 5–6)._** _Dexterity Saving Throw:_ DC 21, each creature in a 60-foot Cone. _Failure:_ 59 (17d6) Fire damage. _Success:_ Half damage.

**_Spellcasting._** The dragon casts one of the following spells (spell save DC 20): <br>
&emsp;**At Will:** _Command_, _Detect Magic_ <br>
&emsp;**1/Day:** _Fireball_

#### Legendary Actions

_Legendary Action Uses: 3 (4 in Lair)._

**_Pounce._** The dragon moves up to half its Speed, and it makes one Rend attack.

### Troll

_Large Giant, Chaotic Evil_
`;

describe('slugify', () => {
  it('makes lowercase hyphenated ids', () => {
    expect(slugify('Goblin Warrior')).toBe('goblin-warrior');
    expect(slugify("Will-o’-Wisp")).toBe('will-o-wisp');
    expect(slugify('Saber-Toothed Tiger')).toBe('saber-toothed-tiger');
  });
});

describe('splitBlocks', () => {
  it('finds stat blocks, ignoring group headings and prose', () => {
    const md = `# Monsters\n\nSome intro text.\n\n${GOBLIN}\n${DRAGON.replace(/### Troll[\s\S]*$/, '')}`;
    const blocks = splitBlocks(md.split('\n'));
    expect(blocks.map((b) => b[0])).toEqual(['### Goblin Warrior', '### Adult Red Dragon']);
  });

  it('keeps the section headings inside their block', () => {
    const [block] = splitBlocks(GOBLIN.split('\n'));
    expect(block!.join('\n')).toContain('#### Bonus Actions');
  });

  it('ends a block at the next monster', () => {
    const blocks = splitBlocks((GOBLIN + '\n' + GOBLIN.replace('Goblin Warrior', 'Goblin Boss')).split('\n'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.join('\n')).not.toContain('Goblin Boss');
  });
});

describe('parseSrdBlock', () => {
  const goblin = parseSrdBlock(splitBlocks(GOBLIN.split('\n'))[0]!);

  it('reads the header fields', () => {
    expect(goblin.problems).toEqual([]);
    expect(goblin.def).toMatchObject({
      id: 'goblin-warrior',
      name: 'Goblin Warrior',
      size: 'small',
      type: 'fey',
      subtype: 'goblinoid',
      alignment: 'Chaotic Neutral',
      cr: '1/4',
      crValue: 0.25,
      xp: 50,
      proficiencyBonus: 2,
      ac: 15,
      hp: 10,
      hitDice: '3d6',
      initiativeBonus: 0,
    });
  });

  it('reads ability scores and finds no proficient saves', () => {
    expect(goblin.def.abilityScores).toEqual({ str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 });
    expect(goblin.def.saveBonuses).toEqual({});
  });

  it('parses the attack and keeps the bonus action as a feature', () => {
    expect(goblin.def.actions).toEqual([
      { kind: 'attack', name: 'Scimitar', attack: { name: 'Scimitar', toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } },
    ]);
    expect(goblin.def.bonusActions).toEqual([{ name: 'Nimble Escape', text: 'The goblin takes the Disengage or Hide action.' }]);
  });

  const dragon = parseSrdBlock(splitBlocks(DRAGON.split('\n'))[0]!);

  it('reads the dragon: saves, defenses, XP with a lair value, initiative', () => {
    expect(dragon.problems).toEqual([]);
    expect(dragon.def).toMatchObject({ type: 'dragon', subtype: 'chromatic', xp: 18000, proficiencyBonus: 6, hp: 256, hitDice: '19d12+133' });
    expect(dragon.def.saveBonuses).toEqual({ dex: 6, wis: 7 });
    expect(dragon.def.initiativeBonus).toBe(12);
    expect(dragon.def.resistances).toEqual(['cold']);
    expect(dragon.def.immunities).toEqual(['fire']);
    expect(dragon.def.conditionImmunities).toEqual(['Charmed']);
  });

  it('reads multiattack, a limited breath, spellcasting, traits and legendary actions', () => {
    expect(dragon.def.multiattack?.parts).toEqual([{ action: 'Rend', count: 3 }]);
    expect(dragon.def.actions.map((a) => [a.name, a.limit])).toEqual([
      ['Rend', undefined],
      ['Fire Breath', 'Recharge 5-6'],
    ]);
    const rend = dragon.def.actions[0]!;
    expect(rend.kind === 'attack' && rend.attack.damage).toEqual([
      { dice: '1d10+8', type: 'slashing' },
      { dice: '2d4', type: 'fire' },
    ]);
    expect(dragon.def.otherActions.map((f) => f.name)).toEqual(['Spellcasting']);
    expect(dragon.def.otherActions[0]!.text).toContain('At Will: Command, Detect Magic');
    expect(dragon.def.traits.map((f) => f.name)).toEqual(['Legendary Resistance (3/Day, or 4/Day in Lair)']);
    expect(dragon.def.legendaryActions.map((f) => f.name)).toEqual(['Pounce']);
  });

  it('uses an override table when the source table is unreadable', () => {
    const broken = GOBLIN.replace(/<table>[\s\S]*<\/table>/, '<table><tr><td>garbage</td></tr></table>');
    const lines = splitBlocks(broken.split('\n'))[0]!;
    expect(parseSrdBlock(lines).problems).toContain('ability table not readable');
    const override = Object.fromEntries(
      ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [a, { score: 10, mod: 0, save: 0 }]),
    ) as Parameters<typeof parseSrdBlock>[1];
    const r = parseSrdBlock(lines, override);
    expect(r.problems).toEqual([]);
    expect(r.def.abilityScores.str).toBe(10);
  });

  it('reports inconsistencies instead of hiding them', () => {
    const badHp = GOBLIN.replace('**HP** 10 (3d6)', '**HP** 40 (3d6)');
    expect(parseSrdBlock(splitBlocks(badHp.split('\n'))[0]!).problems.join(' ')).toMatch(/does not match hit dice/);
    const badMod = GOBLIN.replace('<td>15</td><td>+2</td>', '<td>15</td><td>+5</td>');
    expect(parseSrdBlock(splitBlocks(badMod.split('\n'))[0]!).problems.join(' ')).toMatch(/dex modifier/);
    const badDamage = GOBLIN.replace('5 (1d6 + 2) Slashing', '9 (1d6 + 2) Slashing');
    expect(parseSrdBlock(splitBlocks(badDamage.split('\n'))[0]!).problems.join(' ')).toMatch(/should average 5/);
  });
});
