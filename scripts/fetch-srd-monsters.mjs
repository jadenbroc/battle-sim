// Downloads the SRD 5.2.1 monster text into data/srd-raw/srd-monsters.md (gitignored cache).
//
// Source: github.com/downfallx/dnd-5e-srd-markdown, a Markdown conversion of the System Reference
// Document 5.2.1. (An API-based dataset was tried first, but it had corrupted records: swapped
// actions between monsters and wrong ability scores. This copy agreed with the rules wherever the
// two differed.) Run `npm run data:build` afterwards.
//
// SRD 5.2.1 content is (c) Wizards of the Coast LLC, licensed CC-BY-4.0.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/downfallx/dnd-5e-srd-markdown/master/';
const FILES = ['monsters-A-Z.md', 'animals.md']; // the Animals appendix holds the beasts
const OUT = join(import.meta.dirname, '..', 'data', 'srd-raw');

await mkdir(OUT, { recursive: true });
let markdown = '';
for (const file of FILES) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`Could not fetch ${file}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.log(`${file}: ${text.length.toLocaleString()} characters`);
  markdown += text + '\n';
}
await writeFile(join(OUT, 'srd-monsters.md'), markdown, 'utf8');
console.log(`Saved ${join(OUT, 'srd-monsters.md')}`);
