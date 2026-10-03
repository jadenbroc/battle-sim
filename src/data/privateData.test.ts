import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrivateSpell } from './parsePrivateSpell';
import { PRIVATE_DATA_FORMAT, PRIVATE_DATA_VERSION, mergeMonsters, mergeSpells, parsePrivateData } from './privateData';
import type { MonsterDef } from './monsterTypes';
import type { SpellDef } from './spellTypes';

const TOLL = `---
name: Toll the Dead
level: 0
school: Necromancy
classes: [Cleric, Warlock, Wizard]
save: wisdom
attack: none
concentration: false
ritual: false
---

# Toll the Dead

**Level:** Cantrip
**Casting Time:** 1 Action
**Range/Area:** 60 feet
**Components:** V, S
**Duration:** Instantaneous

## Effect

The target must succeed on a WIS save or take 1d8 necrotic damage. If the target is missing any of its hit points, it instead takes 1d12 necrotic damage.

## Scaling

Cantrip scaling by character level: damage increases by one die at level 5 (2d8/2d12).
`;

const spell = (name: string, level = 1): SpellDef => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, level, classes: [], notes: [] }) as unknown as SpellDef;
const monster = (id: string): MonsterDef => ({ id, name: id, ac: 10, hp: 5, abilityScores: {}, actions: [] }) as unknown as MonsterDef;

describe('parsePrivateSpell', () => {
  it('reads a save cantrip from the frontmatter and effect text', () => {
    const { def, problems } = parsePrivateSpell(TOLL);
    expect(problems).toEqual([]);
    expect(def).toMatchObject({ id: 'toll-the-dead', level: 0, castingTime: 'Action', private: true });
    expect(def.effect).toMatchObject({ kind: 'save', ability: 'wis', halfOnSave: false });
    expect(def.effect && def.effect.kind === 'save' && def.effect.damage).toEqual([{ dice: '1d8', type: 'necrotic' }]);
  });
});

describe('merging', () => {
  it('adds private spells, marks them, and lets the SRD win on overlap', () => {
    const merged = mergeSpells([spell('Fire Bolt', 0)], [spell('Fire Bolt', 0), spell('Toll the Dead', 0)]);
    expect(merged.map((s) => s.name)).toEqual(['Fire Bolt', 'Toll the Dead']);
    expect(merged.find((s) => s.name === 'Toll the Dead')?.private).toBe(true);
    expect(merged.find((s) => s.name === 'Fire Bolt')?.private).toBeUndefined();
  });
  it('adds private monsters whose id the SRD lacks', () => {
    const merged = mergeMonsters([monster('goblin')], [monster('goblin'), monster('aboleth')]);
    expect(merged.map((m) => m.id)).toEqual(['aboleth', 'goblin']);
    expect(merged.find((m) => m.id === 'aboleth')?.private).toBe(true);
  });
});

describe('parsePrivateData', () => {
  const file = (over: object = {}): string =>
    JSON.stringify({ format: PRIVATE_DATA_FORMAT, version: PRIVATE_DATA_VERSION, generated: 'x', spells: [], monsters: [], ...over });
  it('accepts a valid file', () => {
    expect(parsePrivateData(file()).ok).toBe(true);
  });
  it('rejects bad JSON, the wrong format, and a wrong version', () => {
    expect(parsePrivateData('{').ok).toBe(false);
    expect(parsePrivateData(file({ format: 'other' })).ok).toBe(false);
    expect(parsePrivateData(file({ version: 99 })).ok).toBe(false);
  });
  it('rejects a spell or monster that is missing its basics', () => {
    expect(parsePrivateData(file({ spells: [{ name: 'X' }] })).ok).toBe(false);
    expect(parsePrivateData(file({ monsters: [{ id: 'x', name: 'X' }] })).ok).toBe(false);
  });
});

describe('private data stays private', () => {
  const root = join(import.meta.dirname, '..', '..');
  it('is gitignored and not placed in public/', () => {
    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^data\/private\/$/m);
    expect(ignore).toMatch(/^public\/private\/$/m);
    expect(existsSync(join(root, 'public', 'private'))).toBe(false);
  });
  it('is served only by the dev server', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/apply:\s*'serve'/);
  });
});
