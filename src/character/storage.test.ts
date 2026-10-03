import { describe, expect, it } from 'vitest';
import { blankCharacter } from './edit';
import { clericSheet, clericSpells, toFields } from './fixtures';
import { parseCharacterSheet } from './parseCharacterSheet';
import { PARTY_KEY, loadParty, saveParty, type KeyValueStore } from './storage';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('party storage', () => {
  it('saves and loads a party, keeping the review flags and warnings', () => {
    const store = memory();
    const c = parseCharacterSheet([...toFields(clericSheet({ AC: '' })), ...clericSpells()]).character;
    expect(c.confidence.ac).toBe('missing');
    expect(saveParty([c, blankCharacter('Bob')], store)).toBe(true);
    const back = loadParty(store);
    expect(back.map((x) => x.name)).toEqual(['Test Cleric', 'Bob']);
    expect(back[0]!.confidence.ac).toBe('missing');
    expect(back[0]!.warnings.length).toBeGreaterThan(0);
    expect(back[0]!.spells.length).toBe(c.spells.length);
  });

  it('returns an empty party when nothing is saved, the data is damaged, or storage is missing', () => {
    expect(loadParty(memory())).toEqual([]);
    const bad = memory();
    bad.data.set(PARTY_KEY, '{broken');
    expect(loadParty(bad)).toEqual([]);
    expect(loadParty(undefined)).toEqual([]);
  });

  it('drops a damaged character and keeps the rest', () => {
    const store = memory();
    store.data.set(PARTY_KEY, JSON.stringify([blankCharacter('Good'), { name: 'Broken' }]));
    expect(loadParty(store).map((c) => c.name)).toEqual(['Good']);
  });

  it('never loads more than 8', () => {
    const store = memory();
    saveParty(Array.from({ length: 10 }, (_, i) => blankCharacter(`C${i}`)), store);
    expect(loadParty(store)).toHaveLength(8);
  });

  it('reports failure instead of throwing when storage refuses', () => {
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveParty([blankCharacter()], full)).toBe(false);
    expect(saveParty([blankCharacter()], undefined)).toBe(false);
  });
});
