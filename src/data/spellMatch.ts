import { slugify } from './parseSrdMarkdown';
import type { SpellDef } from './spellTypes';

/**
 * Find a spell in a library by name. The 2024 SRD dropped the proper names from many spells
 * ("Tasha's Hideous Laughter" is "Hideous Laughter", "Melf's Acid Arrow" is "Acid Arrow"), so a
 * possessive prefix is tried without.
 */
export function findLibrarySpell(library: readonly SpellDef[], name: string): SpellDef | undefined {
  const byId = new Map(library.map((s) => [s.id, s]));
  const plain = name.replace(/\s*\[R\]\s*$/i, '').trim();
  const direct = byId.get(slugify(plain));
  if (direct) return direct;
  const noPossessive = plain.replace(/^[A-Z][\w-]*(?:['’]s)\s+/, '');
  return noPossessive !== plain ? byId.get(slugify(noPossessive)) : undefined;
}
