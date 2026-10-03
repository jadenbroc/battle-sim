import type { MonsterDef } from './monsterTypes';
import { findLibrarySpell } from './spellMatch';
import type { SpellDef } from './spellTypes';

/** The file the private-data build writes, and the app's "Load private data" reads. */
export const PRIVATE_DATA_FORMAT = 'battle-sim-private-data';
export const PRIVATE_DATA_VERSION = 1;

export interface PrivateData {
  format: typeof PRIVATE_DATA_FORMAT;
  version: number;
  generated: string;
  spells: SpellDef[];
  monsters: MonsterDef[];
}

/** Add the private spells to the SRD library. A private spell the SRD already has is left out. */
export function mergeSpells(srd: readonly SpellDef[], priv: readonly SpellDef[]): SpellDef[] {
  const extra = priv.filter((s) => !findLibrarySpell(srd, s.name)).map((s) => ({ ...s, private: true as const }));
  return [...srd, ...extra].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** Add the private monsters to the SRD library. A private monster whose id the SRD has is left out. */
export function mergeMonsters(srd: readonly MonsterDef[], priv: readonly MonsterDef[]): MonsterDef[] {
  const have = new Set(srd.map((m) => m.id));
  const extra = priv.filter((m) => !have.has(m.id)).map((m) => ({ ...m, private: true as const }));
  return [...srd, ...extra].sort((a, b) => a.name.localeCompare(b.name));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type PrivateParse = { ok: true; data: PrivateData } | { ok: false; error: string };

/**
 * Read a private-data file. The shape of each spell and monster is checked only loosely (the file
 * is one the user made or generated), but anything that would break the app is rejected.
 */
export function parsePrivateData(text: string): PrivateParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  if (!isObj(raw) || raw.format !== PRIVATE_DATA_FORMAT) return { ok: false, error: `not a ${PRIVATE_DATA_FORMAT} file` };
  if (raw.version !== PRIVATE_DATA_VERSION) return { ok: false, error: `unsupported version ${String(raw.version)}` };

  const spells = Array.isArray(raw.spells) ? raw.spells : [];
  for (const s of spells) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.level !== 'number' || !Array.isArray(s.classes) || !Array.isArray(s.notes)) {
      return { ok: false, error: `a spell is missing id, name, level, classes or notes${isObj(s) && typeof s.name === 'string' ? ` (${s.name})` : ''}` };
    }
    if (s.effect !== undefined && (!isObj(s.effect) || !['attack', 'save', 'heal'].includes(String(s.effect.kind)))) return { ok: false, error: `spell "${s.name}" has an unknown effect` };
  }
  const monsters = Array.isArray(raw.monsters) ? raw.monsters : [];
  for (const m of monsters) {
    if (!isObj(m) || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.ac !== 'number' || typeof m.hp !== 'number' || !isObj(m.abilityScores) || !Array.isArray(m.actions)) {
      return { ok: false, error: `a monster is missing id, name, ac, hp, abilityScores or actions${isObj(m) && typeof m.name === 'string' ? ` (${m.name})` : ''}` };
    }
  }
  return {
    ok: true,
    data: {
      format: PRIVATE_DATA_FORMAT,
      version: PRIVATE_DATA_VERSION,
      generated: typeof raw.generated === 'string' ? raw.generated : '',
      spells: spells as SpellDef[],
      monsters: monsters as MonsterDef[],
    },
  };
}
