import './style.css';
import type { BulkResult } from './engine/bulk';
import { runFight, type LoggedEvent } from './engine/fight';
import { createRng } from './engine/rng';
import type { BulkMessage, BulkRequest } from './bulk.worker';
import { sampleFight } from './sample';
import { formatEvent, viewAt, type FighterView } from './ui/replay';

const config = sampleFight();

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>Battle Sim</h1>
    <p class="sub">Demo: Fighter, Cleric and Wizard vs. 4 goblins. All rolls come from a seeded RNG.</p>
  </header>

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
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const seedInput = $<HTMLInputElement>('seed');
seedInput.value = Math.random().toString(36).slice(2, 8);

let log: LoggedEvent[] = [];
let shown = 0;
let timer: number | undefined;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

function stopPlaying(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  $('play').textContent = 'Play';
}

function renderStatus(views: FighterView[]): string {
  const group = (team: FighterView['team'], title: string): string => `
    <h3>${title}</h3>
    ${views
      .filter((v) => v.team === team)
      .map((v) => {
        const pct = Math.max(0, Math.round((v.hp / v.maxHp) * 100));
        const tag = v.status === 'alive' ? '' : v.status === 'down' ? 'down' : v.status;
        return `<div class="fighter ${v.status}">
          <div class="fighter-top"><span>${escapeHtml(v.name)}</span><span>${v.hp}/${v.maxHp} ${tag}</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>`;
      })
      .join('')}`;
  return group('party', 'Party') + group('enemies', 'Enemies');
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
  const result = runFight(config, createRng(seed), { log: true });
  log = result.log;
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

let worker: Worker | undefined;

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

$('run').click();
