// Builds data/private/private-data.json from the author's own markdown library (private use only).
//
//   npm run data:private                       reads C:/AI Ecosystem/_shared/knowledge
//   npm run data:private -- --source <dir>     reads another folder (with spells/ inside)
//
// The output is gitignored (data/private/) and is never part of a build or a deploy: the dev server
// serves it to the app on your machine, and you can load the same file into the app's own storage with
// "Load private data". Only creatures and spells that are NOT in the bundled SRD library are written,
// since the SRD versions are already shipped and checked.
//
// The spells that ARE in both libraries are used as a check: the same spell parsed from the author's
// wording and from the SRD wording must come out the same, and disagreements are reported.
import { existsSync, readdirSync, readFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MonsterDef } from '../src/data/monsterTypes.ts';
import { parsePrivateMonster } from '../src/data/parsePrivateMonster.ts';
import { parsePrivateSpell } from '../src/data/parsePrivateSpell.ts';
import { PRIVATE_DATA_FORMAT, PRIVATE_DATA_VERSION, type PrivateData } from '../src/data/privateData.ts';
import { findLibrarySpell } from '../src/data/spellMatch.ts';
import type { SpellDef } from '../src/data/spellTypes.ts';
import { parseDice } from '../src/engine/dice.ts';
import { ABILITIES, isDamageType } from '../src/engine/types.ts';

const root = join(import.meta.dirname, '..');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const source = arg('source') ?? 'C:/AI Ecosystem/_shared/knowledge';
const outDir = join(root, 'data', 'private');

const srdSpells = JSON.parse(readFileSync(join(root, 'src', 'data', 'srd-spells.json'), 'utf8')) as SpellDef[];

const problems: string[] = [];
const spells: SpellDef[] = [];

// ----- Spells -----

const spellDir = join(source, 'spells');
if (!existsSync(spellDir)) {
  console.error(`No spells folder at ${spellDir}`);
  process.exit(1);
}

const all: SpellDef[] = [];
for (const file of readdirSync(spellDir).filter((f) => f.endsWith('.md') && !f.startsWith('00_'))) {
  const { def, problems: p } = parsePrivateSpell(readFileSync(join(spellDir, file), 'utf8'));
  for (const msg of p) problems.push(`spells/${file}: ${msg}`);
  all.push(def);
}

// Compare spells that exist in both libraries.
const key = (s: SpellDef): string => {
  const e = s.effect;
  if (!e) return 'none';
  if (e.kind === 'heal') return `heal ${e.dice} ${e.addsModifier}`;
  if (e.kind === 'buff') return `buff ${e.targets} ${e.rollModifier.dice}`;
  const dmg = e.damage.map((d) => d.dice + d.type).join('+');
  return e.kind === 'attack'
    ? `attack ${e.range} ${e.autoHit ? 'auto' : ''} x${e.count ?? 1} ${dmg}`
    : `save ${e.ability} ${e.halfOnSave ? 'half' : ''} ${e.area ? 'area' : ''} ${dmg} ${(e.effects ?? []).map((f) => f.condition).join(',')}`;
};
let compared = 0;
let agree = 0;
const disagreements: string[] = [];
for (const s of all) {
  const srd = findLibrarySpell(srdSpells, s.name);
  if (!srd) {
    if (s.id) spells.push(s);
    continue;
  }
  if (!srd.effect && !s.effect) continue;
  compared++;
  if (srd.level !== s.level) disagreements.push(`${s.name}: level ${s.level} vs SRD ${srd.level}`);
  else if (key(srd) === key(s)) agree++;
  else disagreements.push(`${s.name}: ${key(s)}  |  SRD ${key(srd)}`);
}

// Sanity checks on what is kept.
for (const s of spells) {
  const e = s.effect;
  if (!e) continue;
  const dice = e.kind === 'heal' ? [e.dice] : e.kind === 'buff' ? (e.rollModifier.dice ? [e.rollModifier.dice] : []) : e.damage.map((d) => d.dice);
  for (const d of dice) {
    try {
      parseDice(d);
    } catch {
      problems.push(`${s.name}: bad dice ${d}`);
    }
  }
  if (e.kind === 'attack' || e.kind === 'save') for (const d of e.damage) if (!isDamageType(d.type)) problems.push(`${s.name}: bad damage type ${d.type}`);
}

spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

// ----- Monsters -----

const srdMonsters = JSON.parse(readFileSync(join(root, 'src', 'data', 'srd-monsters.json'), 'utf8')) as MonsterDef[];
const srdById = new Map(srdMonsters.map((m) => [m.id, m]));
const monsterDir = join(source, 'monsters');
const monsters: MonsterDef[] = [];
const monsterWarnings: string[] = [];
const monstersSkipped: string[] = [];
const monsterDisagreements: string[] = [];
let monstersRead = 0;
let monstersCompared = 0;
let monstersAgree = 0;

const firstAttack = (m: MonsterDef): string => {
  const a = m.actions.find((x) => x.kind === 'attack');
  return a && a.kind === 'attack' ? `${a.attack.toHit}/${a.attack.damage.map((d) => d.dice + d.type).join('+')}` : '-';
};

if (existsSync(monsterDir)) {
  for (const type of readdirSync(monsterDir)) {
    const dir = join(monsterDir, type);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      monstersRead++;
      const { def, problems: p } = parsePrivateMonster(readFileSync(join(dir, file), 'utf8'));
      const readable = Number.isFinite(def.ac) && Number.isFinite(def.hp) && ABILITIES.every((a) => Number.isFinite(def.abilityScores[a])) && Number.isFinite(def.crValue);
      if (!readable) {
        // Stat blocks with variable numbers (a Celestial Spirit's HP) cannot be turned into one monster.
        monstersSkipped.push(`monsters/${type}/${file}: ${p.join('; ') || 'unreadable'}`);
        continue;
      }
      for (const msg of p) monsterWarnings.push(`monsters/${type}/${file}: ${msg}`);
      const srd = srdById.get(def.id);
      if (srd) {
        monstersCompared++;
        const diffs: string[] = [];
        if (srd.ac !== def.ac) diffs.push(`AC ${def.ac} vs ${srd.ac}`);
        if (srd.hp !== def.hp) diffs.push(`HP ${def.hp} vs ${srd.hp}`);
        if (srd.cr !== def.cr) diffs.push(`CR ${def.cr} vs ${srd.cr}`);
        if (ABILITIES.some((a) => srd.abilityScores[a] !== def.abilityScores[a])) diffs.push('ability scores');
        if (firstAttack(srd) !== firstAttack(def)) diffs.push(`first attack ${firstAttack(def)} vs ${firstAttack(srd)}`);
        if (diffs.length) monsterDisagreements.push(`${def.name}: ${diffs.join(', ')}`);
        else monstersAgree++;
      } else monsters.push(def);
    }
  }
  monsters.sort((a, b) => a.name.localeCompare(b.name));
}

const data: PrivateData = {
  format: PRIVATE_DATA_FORMAT,
  version: PRIVATE_DATA_VERSION,
  generated: new Date().toISOString(),
  spells,
  monsters,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'private-data.json'), JSON.stringify(data) + '\n', 'utf8');

// `--bundle-spells` also writes the spells to src/data/book-spells.json, which IS committed and shipped
// as part of the default spell list (a deliberate decision: see "Data and licensing" in CLAUDE.md).
if (process.argv.includes('--bundle-spells')) {
  const bundled = spells.map(({ private: _private, ...rest }) => rest);
  writeFileSync(join(root, 'src', 'data', 'book-spells.json'), JSON.stringify(bundled) + '\n', 'utf8');
  console.log(`Bundled ${bundled.length} spells into src/data/book-spells.json`);
}

// `--bundle-monsters` does the same for the monsters (src/data/book-monsters.json).
if (process.argv.includes('--bundle-monsters')) {
  const bundled = monsters.map(({ private: _private, ...rest }) => rest);
  writeFileSync(join(root, 'src', 'data', 'book-monsters.json'), JSON.stringify(bundled) + '\n', 'utf8');
  console.log(`Bundled ${bundled.length} monsters into src/data/book-monsters.json`);
}

const simulated = spells.filter((s) => s.effect);
console.log(`Read ${all.length} spells from ${spellDir}`);
console.log(`Wrote ${spells.length} that are not in the SRD library (${simulated.length} with a simulated effect) to ${join(outDir, 'private-data.json')}`);
console.log(`Check against the SRD copy of ${compared} spells present in both: ${agree} agree, ${disagreements.length} differ`);
for (const d of disagreements) console.log(`    DIFF ${d}`);
const withAttacks = monsters.filter((m) => m.actions.some((a) => !a.limit && !a.bonus)).length;
console.log(`\nRead ${monstersRead} monsters from ${monsterDir}`);
console.log(`Wrote ${monsters.length} that are not in the SRD library (${withAttacks} with a simulated attack)`);
console.log(`Check against the SRD copy of ${monstersCompared} monsters present in both: ${monstersAgree} agree, ${monsterDisagreements.length} differ`);
for (const d of monsterDisagreements.slice(0, 40)) console.log(`    DIFF ${d}`);
if (monsterDisagreements.length > 40) console.log(`    ... and ${monsterDisagreements.length - 40} more`);
console.log(`Skipped (could not be read): ${monstersSkipped.length}`);
for (const s of monstersSkipped) console.log(`    ${s}`);
console.log(`Monster data warnings (kept, but worth a look): ${monsterWarnings.length}`);
for (const w of monsterWarnings.slice(0, 25)) console.log(`    ${w}`);
if (monsterWarnings.length > 25) console.log(`    ... and ${monsterWarnings.length - 25} more`);

console.log(`\nProblems: ${problems.length}`);
for (const p of problems) console.log(`    ${p}`);
if (problems.length) process.exitCode = 1;
