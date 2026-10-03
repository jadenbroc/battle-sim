// Builds src/data/srd-monsters.json from data/srd-raw/srd-monsters.md (see `npm run data:fetch`).
//
// Every stat block is parsed and checked for consistency: ability modifiers match scores, hit points
// match hit dice, printed damage averages match their dice. The script exits with an error if any
// block fails to parse or fails a check.
//
// SRD 5.2.1 content is (c) Wizards of the Coast LLC, licensed CC-BY-4.0.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSrdBlock, splitBlocks, type AbilityTable } from '../src/data/parseSrdMarkdown.ts';
import type { MonsterDef } from '../src/data/monsterTypes.ts';

const root = join(import.meta.dirname, '..');
const markdown = (await readFile(join(root, 'data', 'srd-raw', 'srd-monsters.md'), 'utf8')).split(/\r?\n/);
const outFile = join(root, 'src', 'data', 'srd-monsters.json');

const overrides = JSON.parse(await readFile(join(root, 'data', 'srd-overrides.json'), 'utf8')) as Record<string, AbilityTable>;

const monsters: MonsterDef[] = [];
const problems: string[] = [];
const seen = new Map<string, number>();
const usedOverrides = new Set<string>();

for (const block of splitBlocks(markdown)) {
  const name = /^#+\s+(.+?)\s*$/.exec(block[0]!)![1]!;
  const override = overrides[name.replace(/’/g, "'")];
  if (override) usedOverrides.add(name);
  const { def, problems: p } = parseSrdBlock(block, override);
  for (const msg of p) problems.push(`${def.name}: ${msg}`);
  if (!def.hp) continue; // unreadable block, already reported
  seen.set(def.id, (seen.get(def.id) ?? 0) + 1);
  monsters.push(def);
}
for (const [id, n] of seen) if (n > 1) problems.push(`${id}: appears ${n} times`);
for (const key of Object.keys(overrides)) {
  if (key !== '_comment' && ![...usedOverrides].some((n) => n.replace(/’/g, "'") === key)) problems.push(`override for "${key}" matched no stat block`);
}

monsters.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(outFile, JSON.stringify(monsters) + '\n', 'utf8');

const noActions = monsters.filter((m) => !m.actions.some((a) => !a.limit));
const multiBroken = monsters.filter((m) => {
  if (!m.multiattack) return false;
  const names = new Set(m.actions.filter((a) => !a.limit).map((a) => a.name.toLowerCase()));
  return m.multiattack.parts.length === 0 || !m.multiattack.parts.every((p) => (p.options ?? [p.action]).some((n) => names.has(n.toLowerCase())));
});

console.log(`Wrote ${monsters.length} monsters to ${outFile}`);
console.log(`  no simulated action (${noActions.length}): ${noActions.map((m) => m.name).join(', ')}`);
console.log(`  multiattack not fully resolved (${multiBroken.length}): ${multiBroken.map((m) => m.name).join(', ')}`);
console.log(`  problems: ${problems.length}`);
for (const p of problems) console.log(`    ${p}`);
if (problems.length) process.exitCode = 1;
