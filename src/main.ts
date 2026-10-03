import './style.css';
import type { BulkResult } from './engine/bulk';
import { runFight, type FightConfig, type LoggedEvent } from './engine/fight';
import { createRng } from './engine/rng';
import type { BulkMessage, BulkRequest } from './bulk.worker';
import type { MonsterDef } from './data/monsterTypes';
import {
  MAX_GROUP_SIZE,
  adjustGroup,
  buildEnemyGroup,
  groupSize,
  loadSrdMonsters,
  monsterTypes,
  notSimulated,
  searchMonsters,
  type GroupEntry,
} from './data/monsters';
import type { Character } from './character/characterTypes';
import { missingRequired } from './character/parseCharacterSheet';
import { loadParty } from './character/storage';
import { characterToCombatant } from './character/toCombatant';
import type { SpellDef } from './data/spellTypes';
import { loadSrdSpells } from './data/spells';
import type { Combatant } from './engine/types';
import { sampleParty } from './sample';
import { createPartyPanel } from './ui/partyPanel';
import { formatEvent, viewAt, type FighterView } from './ui/replay';

const CR_STEPS: [string, number][] = [
  ['0', 0],
  ['1/8', 0.125],
  ['1/4', 0.25],
  ['1/2', 0.5],
  ...[1, 2, 3, 4, 5, 6, 8, 10, 13, 17, 20, 24, 30].map((n): [string, number] => [String(n), n]),
];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>Battle Sim</h1>
    <p class="sub">Your party (or the demo party) vs. a group of SRD 5.2 monsters. All rolls come from a seeded RNG.</p>
  </header>

  <section class="card" id="party"></section>

  <section class="card">
    <div class="row between">
      <h2>Enemies</h2>
      <span id="group-count" class="muted"></span>
    </div>
    <div class="enemies-grid">
      <div>
        <div class="row filters">
          <input id="q" type="search" placeholder="Search monsters" spellcheck="false" />
          <select id="type" aria-label="Creature type"><option value="">All types</option></select>
          <label>CR <select id="cr-min" aria-label="Minimum CR"></select> to <select id="cr-max" aria-label="Maximum CR"></select></label>
        </div>
        <div id="monster-list" class="list" aria-live="polite">Loading monsters...</div>
      </div>
      <div>
        <h3>Group</h3>
        <div id="group"></div>
        <details id="warnings" class="warnings" hidden><summary>Not simulated yet</summary><div id="warnings-body"></div></details>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="row">
      <label>Seed <input id="seed" type="text" spellcheck="false" /></label>
      <button id="run" class="primary">Run one fight</button>
    </div>
    <p class="hint">Bulk fight #3 of seed <code>abc</code> replays here as <code>abc:3</code>.</p>
  </section>

  <section class="card" id="fight" hidden>
    <div class="row controls">
      <button id="prev">&larr; Prev</button>
      <button id="next">Next &rarr;</button>
      <button id="play">Play</button>
      <button id="end">Skip to end</button>
      <span id="counter" class="muted"></span>
    </div>
    <div class="fight-grid">
      <div id="log" class="log" aria-live="polite"></div>
      <div id="status"></div>
    </div>
  </section>

  <section class="card">
    <div class="row">
      <label>Fights <input id="runs" type="number" min="1" max="100000" value="2000" /></label>
      <button id="bulk" class="primary">Run bulk</button>
      <span id="progress" class="muted"></span>
    </div>
    <div id="results"></div>
  </section>

  <footer class="attribution">
    This work includes material from the System Reference Document 5.2.1 (&ldquo;SRD 5.2.1&rdquo;) by Wizards of the Coast LLC,
    available at <a href="https://www.dndbeyond.com/srd" target="_blank" rel="noopener">dndbeyond.com/srd</a>.
    The SRD 5.2.1 is licensed under the
    <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">Creative Commons Attribution 4.0 International License</a>.
  </footer>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>('seed');
seedInput.value = Math.random().toString(36).slice(2, 8);

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

let spells: SpellDef[] = [];
let characters: Character[] = []; // the imported party; empty means "use the demo party"
let party: Combatant[] = sampleParty();
let library: MonsterDef[] = [];
let group: GroupEntry[] = [{ id: 'goblin-warrior', count: 4 }];
let config: FightConfig = { combatants: party };

let log: LoggedEvent[] = [];
let shown = 0;
let timer: number | undefined;
let worker: Worker | undefined;

// ----- Enemy picker -----

for (const sel of [$<HTMLSelectElement>('cr-min'), $<HTMLSelectElement>('cr-max')]) {
  sel.innerHTML = CR_STEPS.map(([label, value]) => `<option value="${value}">${label}</option>`).join('');
}
$<HTMLSelectElement>('cr-max').value = '30';

function renderMonsterList(): void {
  const matches = searchMonsters(library, {
    query: $<HTMLInputElement>('q').value,
    type: $<HTMLSelectElement>('type').value || undefined,
    minCr: Number($<HTMLSelectElement>('cr-min').value),
    maxCr: Number($<HTMLSelectElement>('cr-max').value),
  });
  $('monster-list').innerHTML =
    matches
      .map(
        (m) => `<div class="mon">
          <div><strong>${escapeHtml(m.name)}</strong>
            <span class="muted">CR ${escapeHtml(m.cr)} &middot; ${escapeHtml(m.size)} ${escapeHtml(m.type)} &middot; AC ${m.ac} &middot; HP ${m.hp}</span></div>
          <button data-add="${escapeHtml(m.id)}" aria-label="Add ${escapeHtml(m.name)}">+</button>
        </div>`,
      )
      .join('') || '<p class="muted">No monsters match.</p>';
}

function renderGroup(): void {
  const byId = new Map(library.map((m) => [m.id, m]));
  $('group-count').textContent = `${groupSize(group)} / ${MAX_GROUP_SIZE} monsters`;
  $('group').innerHTML =
    group
      .map((e) => {
        const m = byId.get(e.id);
        return `<div class="mon">
          <div><strong>${escapeHtml(m?.name ?? e.id)}</strong> <span class="muted">${m ? `CR ${escapeHtml(m.cr)}` : 'unknown'}</span></div>
          <div class="qty">
            <button data-adj="-1" data-id="${escapeHtml(e.id)}" aria-label="Fewer">&minus;</button>
            <span>${e.count}</span>
            <button data-adj="1" data-id="${escapeHtml(e.id)}" aria-label="More">+</button>
            <button data-adj="-99" data-id="${escapeHtml(e.id)}" aria-label="Remove">&times;</button>
          </div>
        </div>`;
      })
      .join('') || '<p class="muted">Add at least one monster to run a fight.</p>';

  const notes = group.flatMap((e) => {
    const m = byId.get(e.id);
    const items = m ? notSimulated(m) : [];
    return items.length ? [`<p><strong>${escapeHtml(m!.name)}</strong></p><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`] : [];
  });
  $('warnings').hidden = notes.length === 0;
  $('warnings-body').innerHTML = notes.join('');
}

/** The party for the fight: the imported characters that are complete, or the demo party. */
function currentParty(): Combatant[] {
  if (characters.length === 0) return sampleParty(spells);
  return characters.filter((c) => missingRequired(c).length === 0).map((c) => characterToCombatant(c, spells).combatant);
}

/** The party or the enemy group changed: rebuild the fight and clear what was showing. */
function groupChanged(): void {
  stopPlaying();
  worker?.terminate();
  party = currentParty();
  const { combatants } = buildEnemyGroup(library, group);
  config = { combatants: [...party, ...combatants] };
  log = [];
  shown = 0;
  $('fight').hidden = true;
  $('results').innerHTML = '';
  $('progress').textContent = '';
  const ready = combatants.length > 0 && party.length > 0;
  $<HTMLButtonElement>('bulk').disabled = !ready;
  $<HTMLButtonElement>('run').disabled = !ready;
  renderGroup();
}

for (const id of ['q', 'type', 'cr-min', 'cr-max']) $(id).addEventListener('input', renderMonsterList);

$('monster-list').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-add]')?.dataset.add;
  if (!id) return;
  group = adjustGroup(group, id, 1);
  groupChanged();
});

$('group').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-adj]');
  if (!btn?.dataset.id) return;
  group = adjustGroup(group, btn.dataset.id, Number(btn.dataset.adj));
  groupChanged();
});

// ----- Single fight (step-through) -----

function stopPlaying(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  $('play').textContent = 'Play';
}

function renderStatus(views: FighterView[]): string {
  const section = (team: FighterView['team'], title: string): string => `
    <h3>${title}</h3>
    ${views
      .filter((v) => v.team === team)
      .map((v) => {
        const pct = Math.max(0, Math.round((v.hp / v.maxHp) * 100));
        const tag = v.status === 'alive' ? '' : v.status;
        const chips = v.conditions.map((c) => `<span class="chip ${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('');
        return `<div class="fighter ${v.status}">
          <div class="fighter-top"><span>${escapeHtml(v.name)}</span><span>${v.hp}/${v.maxHp} ${tag}</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
          ${chips ? `<div class="chips">${chips}</div>` : ''}
        </div>`;
      })
      .join('')}`;
  return section('party', 'Party') + section('enemies', 'Enemies');
}

function render(): void {
  const logEl = $('log');
  logEl.replaceChildren(
    ...log.slice(0, shown).map(({ event }) => {
      const f = formatEvent(event);
      const el = document.createElement('div');
      el.className = `event ${f.kind}`;
      el.textContent = f.text;
      return el;
    }),
  );
  logEl.scrollTop = logEl.scrollHeight;
  $('status').innerHTML = renderStatus(viewAt(config, log, shown));
  $('counter').textContent = `Event ${shown} of ${log.length}`;
  $<HTMLButtonElement>('prev').disabled = shown <= 1;
  $<HTMLButtonElement>('next').disabled = shown >= log.length;
  $<HTMLButtonElement>('end').disabled = shown >= log.length;
  if (shown >= log.length) stopPlaying();
}

function step(delta: number): void {
  shown = Math.min(log.length, Math.max(1, shown + delta));
  render();
}

$('run').addEventListener('click', () => {
  stopPlaying();
  const seed = seedInput.value.trim() || '0';
  log = runFight(config, createRng(seed), { log: true }).log;
  shown = 1;
  $('fight').hidden = false;
  render();
});
$('prev').addEventListener('click', () => {
  stopPlaying();
  step(-1);
});
$('next').addEventListener('click', () => {
  stopPlaying();
  step(1);
});
$('end').addEventListener('click', () => {
  stopPlaying();
  step(log.length);
});
$('play').addEventListener('click', () => {
  if (timer !== undefined) return stopPlaying();
  if (shown >= log.length) shown = 1;
  $('play').textContent = 'Pause';
  timer = window.setInterval(() => step(1), 600);
  render();
});

// ----- Bulk -----

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

function renderResults(r: BulkResult): void {
  const b = r.buckets;
  const row = (label: string, n: number): string =>
    `<tr><td>${label}</td><td class="num">${n.toLocaleString()}</td><td class="num">${pct(n / r.runs)}</td></tr>`;
  const creature = (c: BulkResult['combatants'][number]): string =>
    `<tr><td>${escapeHtml(c.name)}</td><td class="num">${c.avgDamagePerRound.toFixed(2)}</td><td class="num">${pct(c.survivalRate)}</td></tr>`;

  $('results').innerHTML = `
    <p class="headline"><strong>${pct(r.winRate)}</strong> party win rate &middot; ${r.avgRounds.toFixed(2)} rounds on average
      <span class="muted">(${r.runs.toLocaleString()} fights, seed <code>${escapeHtml(String(r.seed))}</code>)</span></p>
    <div class="tables">
      <table><thead><tr><th>Outcome</th><th class="num">Fights</th><th class="num">Share</th></tr></thead><tbody>
        ${row('Won, nobody died', b['won-clean'])}${row('Won with deaths', b['won-deaths'])}
        ${row('Total party kill', b.tpk)}${row('Stalemate', b.stalemate)}
      </tbody></table>
      <table><thead><tr><th>Creature</th><th class="num">Dmg / round</th><th class="num">Survived</th></tr></thead><tbody>
        ${r.combatants.map(creature).join('')}
      </tbody></table>
    </div>`;
}

$('bulk').addEventListener('click', () => {
  worker?.terminate();
  const runs = Math.max(1, Math.min(100000, Math.floor(Number($<HTMLInputElement>('runs').value) || 1)));
  const button = $<HTMLButtonElement>('bulk');
  button.disabled = true;
  $('progress').textContent = 'Starting...';

  const w = new Worker(new URL('./bulk.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (e: MessageEvent<BulkMessage>) => {
    if (e.data.type === 'progress') {
      $('progress').textContent = `${e.data.done.toLocaleString()} / ${e.data.total.toLocaleString()}`;
    } else {
      renderResults(e.data.result);
      $('progress').textContent = '';
      button.disabled = false;
      w.terminate();
    }
  };
  w.onerror = (e) => {
    $('progress').textContent = `Error: ${e.message}`;
    button.disabled = false;
  };
  const request: BulkRequest = { config, runs, seed: seedInput.value.trim() || '0' };
  w.postMessage(request);
});

// ----- Start -----

Promise.all([loadSrdMonsters(), loadSrdSpells()]).then(
  ([monsters, loadedSpells]) => {
    library = monsters;
    spells = loadedSpells;
    $<HTMLSelectElement>('type').innerHTML =
      '<option value="">All types</option>' + monsterTypes(library).map((t) => `<option value="${t}">${t}</option>`).join('');
    renderMonsterList();
    // The panel reports the saved party straight away, which builds the first fight.
    createPartyPanel($('party'), {
      spells,
      initial: loadParty(),
      onChange: (chars) => {
        characters = [...chars];
        groupChanged();
      },
    });
    $('run').click();
  },
  (err: unknown) => {
    $('monster-list').textContent = `Could not load the monster library: ${String(err)}`;
  },
);
