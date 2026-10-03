// Builds src/data/srd-spells.json from data/srd-raw/spells.md (see `npm run data:fetch`).
//
// Every spell is parsed and checked for consistency. The script exits with an error if a block does
// not parse. It also prints which spells have a simulated effect and which do not, with the reason.
//
// SRD 5.2.1 content is (c) Wizards of the Coast LLC, licensed CC-BY-4.0.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSpellBlock, splitSpellBlocks } from '../src/data/parseSpell.ts';
import type { SpellDef } from '../src/data/spellTypes.ts';

const root = join(import.meta.dirname, '..');
const lines = (await readFile(join(root, 'data', 'srd-raw', 'spells.md'), 'utf8')).split(/\r?\n/);
const outFile = join(root, 'src', 'data', 'srd-spells.json');

const spells: SpellDef[] = [];
const problems: string[] = [];
const seen = new Map<string, number>();

for (const block of splitSpellBlocks(lines)) {
  const { def, problems: p } = parseSpellBlock(block);
  for (const msg of p) problems.push(`${def.name}: ${msg}`);
  seen.set(def.id, (seen.get(def.id) ?? 0) + 1);
  spells.push(def);
}
for (const [id, n] of seen) if (n > 1) problems.push(`${id}: appears ${n} times`);

spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
await writeFile(outFile, JSON.stringify(spells) + '\n', 'utf8');

const byKind = new Map<string, string[]>();
for (const s of spells) {
  const k = s.effect?.kind ?? 'none';
  (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(s.name);
}
console.log(`Wrote ${spells.length} spells to ${outFile}`);
for (const [k, names] of byKind) console.log(`  ${k}: ${names.length}${k === 'none' ? '' : ` (${names.slice(0, 12).join(', ')}${names.length > 12 ? ', ...' : ''})`}`);
console.log(`  problems: ${problems.length}`);
for (const p of problems) console.log(`    ${p}`);
if (problems.length) process.exitCode = 1;
