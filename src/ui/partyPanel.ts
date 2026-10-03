import { combatSummary } from '../character/summary';
import type { Character, Confidence } from '../character/characterTypes';
import { selectCombatSpells, findSpell } from '../character/combatSpells';
import {
  MAX_PARTY,
  PROFILES,
  blankCharacter,
  classesToText,
  damageToText,
  markEdited,
  parseCharacterJson,
  parseClasses,
  parseConditionNames,
  parseDamageTypes,
  setAttackDamage,
  uniqueId,
} from '../character/edit';
import { missingRequired, parseCharacterSheet } from '../character/parseCharacterSheet';
import { loadPdfJs, readPdfFields } from '../character/pdfFields';
import { saveParty } from '../character/storage';
import { characterToCombatant } from '../character/toCombatant';
import type { SpellDef } from '../data/spellTypes';
import { ABILITIES, SIZES } from '../engine/types';

export interface PartyPanelDeps {
  /** The spell library (SRD plus any private data); read each time, since private data can load later. */
  spells(): SpellDef[];
  /** The party saved from an earlier visit. */
  initial: Character[];
  /** Called after every change with the whole party (empty means "use the demo party"). */
  onChange(characters: Character[]): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const num = (n: number): string => (Number.isFinite(n) ? String(n) : '');

/** CSS class that highlights a field the importer was unsure about. */
function flag(c: Character, key: string): string {
  const v: Confidence | undefined = c.confidence[key];
  return v === 'low' ? 'low' : v === 'missing' ? 'missing' : '';
}

export function createPartyPanel(root: HTMLElement, deps: PartyPanelDeps): { refresh(): void } {
  const chars: Character[] = [...deps.initial];
  let editing: string | undefined;
  let messages: string[] = [];
  let spellFilter = '';

  const find = (id: string): Character | undefined => chars.find((c) => c.id === id);

  function changed(): void {
    saveParty(chars);
    deps.onChange(chars);
  }

  // ----- Rendering -----

  function cardHtml(c: Character): string {
    const missing = missingRequired(c);
    return `<div class="mon" data-card="${esc(c.id)}">
      <div><strong>${esc(c.name)}</strong>
        <span class="muted card-summary">${esc(combatSummary(c))}</span>
        ${missing.length ? `<span class="needs">needs attention: ${esc(missing.join(', '))}</span>` : ''}</div>
      <div class="qty">
        <button data-act="review" data-id="${esc(c.id)}">Review</button>
        <button data-act="remove" data-id="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">&times;</button>
      </div>
    </div>`;
  }

  const input = (c: Character, key: string, label: string, value: string, type = 'text', extra = ''): string =>
    `<label class="f ${flag(c, key)}">${label}<input data-f="${key}" type="${type}" value="${esc(value)}" ${extra} /></label>`;

  function editorHtml(c: Character): string {
    const converted = characterToCombatant(c, deps.spells());
    const warnings = [...c.warnings, ...converted.warnings.filter((w) => !c.warnings.includes(w))];
    const casters = c.spellcasting
      .map(
        (k, i) => `<div class="row caster" data-caster="${i}"><strong>${esc(k.name)}</strong>
          <label>ability <select data-f="caster" data-i="${i}" data-k="ability">${ABILITIES.map((a) => `<option ${a === k.ability ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
          <label>save DC <input data-f="caster" data-i="${i}" data-k="saveDC" type="number" value="${k.saveDC}" /></label>
          <label>attack <input data-f="caster" data-i="${i}" data-k="attackBonus" type="number" value="${k.attackBonus}" /></label></div>`,
      )
      .join('');
    const filter = spellFilter.toLowerCase();
    const spells = c.spells
      .map((s, i) => ({ s, i, def: findSpell(deps.spells(), s.name) }))
      .filter(({ s }) => !filter || s.name.toLowerCase().includes(filter))
      .sort((a, b) => (a.def?.level ?? a.s.level) - (b.def?.level ?? b.s.level) || a.s.name.localeCompare(b.s.name))
      .map(({ s, i, def }) => {
        const usable = !!def?.effect;
        const hit = s.save ? `${s.save.ability.toUpperCase()} ${s.save.dc}` : s.attackBonus !== undefined ? `+${s.attackBonus}` : '';
        const why = !def ? 'not in the SRD library' : !def.effect ? 'no simulated effect' : '';
        return `<label class="spell ${usable ? '' : 'dim'}"><input type="checkbox" data-f="spell" data-i="${i}" ${s.inCombat ? 'checked' : ''} ${usable ? '' : 'disabled'} />
          <span>${esc(s.name)}</span><span class="muted">L${def?.level ?? s.level} ${esc(hit)} ${why ? `&middot; ${why}` : ''}</span></label>`;
      })
      .join('');

    return `<div class="editor card" data-editor="${esc(c.id)}">
      <div class="row between"><h3>Review: ${esc(c.name)}</h3><button data-act="done" class="primary">Done</button></div>
      ${warnings.length ? `<details class="warnings" open><summary>${warnings.length} note${warnings.length === 1 ? '' : 's'}</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      ${Object.values(c.confidence).some((v) => v !== 'high') ? '<p class="hint">Highlighted fields were not read cleanly from the sheet: please check them.</p>' : ''}
      <div class="fgrid">
        ${input(c, 'name', 'Name', c.name)}
        ${input(c, 'classes', 'Class and level', classesToText(c), 'text', 'placeholder="Cleric 1 / Wizard 3"')}
        <label class="f ${flag(c, 'size')}">Size<select data-f="size">${SIZES.map((s) => `<option ${s === c.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="f">Targets<select data-f="profile">${PROFILES.map((p) => `<option value="${p}" ${p === c.profile ? 'selected' : ''}>${{ weakest: 'weakest enemy', threat: 'biggest threat', random: 'random' }[p]}</option>`).join('')}</select></label>
        ${input(c, 'ac', 'AC', num(c.ac), 'number')}
        ${input(c, 'maxHp', 'Max HP', num(c.maxHp), 'number')}
        ${input(c, 'initiativeBonus', 'Initiative bonus', num(c.initiativeBonus), 'number')}
        ${input(c, 'attacksPerAction', 'Attacks per Attack action', num(c.attacksPerAction), 'number', 'min="1" max="4"')}
      </div>
      <div class="fgrid six">${ABILITIES.map((a) => input(c, `ability.${a}`, a.toUpperCase(), num(c.abilityScores[a]), 'number')).join('')}</div>
      <div class="fgrid">
        ${input(c, 'resistances', 'Resistances', c.resistances.join(', '))}
        ${input(c, 'vulnerabilities', 'Vulnerabilities', c.vulnerabilities.join(', '))}
        ${input(c, 'immunities', 'Damage immunities', c.immunities.join(', '))}
        ${input(c, 'conditionImmunities', 'Condition immunities', c.conditionImmunities.join(', '))}
      </div>

      <h4>Attacks <span class="muted">(weapons and attack rows; spells are chosen below)</span></h4>
      <div class="attacks">
        ${c.attacks
          .map(
            (a, i) => `<div class="row attack" data-attack="${i}">
              <input data-f="attack" data-i="${i}" data-k="name" value="${esc(a.name)}" aria-label="Attack name" />
              <input data-f="attack" data-i="${i}" data-k="toHit" type="number" value="${num(a.toHit)}" class="${Number.isFinite(a.toHit) ? '' : 'missing'}" aria-label="To hit" />
              <input data-f="attack" data-i="${i}" data-k="damage" value="${esc(damageToText(a.damage))}" aria-label="Damage" />
              <select data-f="attack" data-i="${i}" data-k="range" aria-label="Range"><option ${a.range === 'melee' ? 'selected' : ''}>melee</option><option ${a.range === 'ranged' ? 'selected' : ''}>ranged</option></select>
              <button data-act="remove-attack" data-i="${i}" aria-label="Remove attack">&times;</button></div>`,
          )
          .join('')}
        <button data-act="add-attack">+ Add attack</button>
      </div>

      <h4>Spellcasting</h4>
      ${casters || '<p class="muted">No spellcasting on this character.</p>'}
      <div class="row slots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<label class="${flag(c, 'slots')}">L${l} <input data-f="slot" data-i="${l}" type="number" min="0" max="9" value="${c.slots[l] ?? ''}" /></label>`).join('')}</div>
      ${
        c.spells.length
          ? `<div class="row between"><h4>Spells used in the fight <button data-act="suggest">Suggest combat spells</button></h4><input data-f="spellFilter" type="search" placeholder="Filter spells" value="${esc(spellFilter)}" /></div>
             <div class="spells">${spells || '<p class="muted">No spells match.</p>'}</div>`
          : ''
      }
    </div>`;
  }

  function render(): void {
    const editor = editing ? find(editing) : undefined;
    root.innerHTML = `
      <div class="row between">
        <h2>Party</h2><span class="muted">${chars.length} / ${MAX_PARTY} characters</span>
      </div>
      <div class="row">
        <button data-act="import-pdf" class="primary">Import D&amp;D Beyond PDFs</button>
        <button data-act="add-hand">Add by hand</button>
        <button data-act="import-json">Import JSON</button>
        <button data-act="export-json" ${chars.length ? '' : 'disabled'}>Export JSON</button>
        <button data-act="clear" ${chars.length ? '' : 'disabled'}>Use demo party</button>
        <input id="pdf-input" type="file" accept="application/pdf,.pdf" multiple hidden />
        <input id="json-input" type="file" accept="application/json,.json" hidden />
      </div>
      <p class="hint">PDFs are read in your browser and never uploaded. Characters are kept in this browser only.</p>
      ${messages.length ? `<ul class="messages">${messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      <div id="party-list">${chars.length ? chars.map(cardHtml).join('') : '<p class="muted">No party loaded: the demo party (Fighter, Cleric, Wizard) is used.</p>'}</div>
      ${editor ? editorHtml(editor) : ''}`;
  }

  // ----- Actions -----

  function addCharacter(c: Character): Character {
    c.id = uniqueId(c.id || c.name, chars.map((x) => x.id));
    chars.push(c);
    return c;
  }

  async function importPdfs(files: File[]): Promise<void> {
    messages = [];
    let reviewId: string | undefined;
    try {
      const pdfjs = await loadPdfJs();
      for (const file of files) {
        if (chars.length >= MAX_PARTY) {
          messages.push(`The party is full (${MAX_PARTY}): ${file.name} was not added.`);
          continue;
        }
        try {
          const fields = await readPdfFields(new Uint8Array(await file.arrayBuffer()), pdfjs);
          const { character, readable } = parseCharacterSheet(fields);
          if (!readable) {
            messages.push(`${file.name}: not a D&D Beyond character sheet with form fields. Use "Add by hand" for this character.`);
            continue;
          }
          const added = addCharacter(selectCombatSpells(character, deps.spells()));
          const missing = missingRequired(added);
          messages.push(`${added.name}: imported${missing.length ? `. Needs attention: ${missing.join(', ')}` : ''}.`);
          if (missing.length && !reviewId) reviewId = added.id;
          if (!editing && !reviewId && chars.length === 1) reviewId = added.id;
        } catch (e) {
          messages.push(`${file.name}: could not be read (${e instanceof Error ? e.message : String(e)}). Use "Add by hand".`);
        }
      }
    } catch (e) {
      messages.push(`The PDF reader could not start (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (reviewId) editing = reviewId;
    changed();
    render();
  }

  function importJson(text: string): void {
    const { characters, errors } = parseCharacterJson(text);
    messages = errors.map((e) => `JSON: ${e}`);
    for (const c of characters) {
      if (chars.length >= MAX_PARTY) {
        messages.push(`The party is full (${MAX_PARTY}): ${c.name} was not added.`);
        continue;
      }
      const added = addCharacter(c);
      messages.push(`${added.name}: imported.`);
    }
    changed();
    render();
  }

  function exportJson(): void {
    const blob = new Blob([JSON.stringify(chars, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'battle-sim-party.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const c = editing ? find(editing) : undefined;
    switch (btn.dataset.act) {
      case 'import-pdf':
        root.querySelector<HTMLInputElement>('#pdf-input')!.click();
        break;
      case 'import-json':
        root.querySelector<HTMLInputElement>('#json-input')!.click();
        break;
      case 'export-json':
        exportJson();
        break;
      case 'add-hand':
        if (chars.length >= MAX_PARTY) messages = [`The party is full (${MAX_PARTY}).`];
        else {
          editing = addCharacter(blankCharacter()).id;
          messages = [];
          changed();
        }
        render();
        break;
      case 'clear':
        chars.length = 0;
        editing = undefined;
        messages = [];
        changed();
        render();
        break;
      case 'review':
        editing = id;
        render();
        root.querySelector('.editor')?.scrollIntoView({ block: 'nearest' });
        break;
      case 'remove':
        chars.splice(0, chars.length, ...chars.filter((x) => x.id !== id));
        if (editing === id) editing = undefined;
        changed();
        render();
        break;
      case 'done':
        editing = undefined;
        render();
        break;
      case 'suggest':
        if (c) {
          const i = chars.indexOf(c);
          chars[i] = selectCombatSpells(c, deps.spells());
          changed();
          render();
        }
        break;
      case 'add-attack':
        if (c) {
          c.attacks.push({ name: 'Weapon', toHit: 2, damage: [{ dice: '1d6', type: 'slashing' }], notes: '', range: 'melee', weapon: true });
          changed();
          render();
        }
        break;
      case 'remove-attack':
        if (c) {
          c.attacks.splice(Number(btn.dataset.i), 1);
          changed();
          render();
        }
        break;
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement & HTMLSelectElement;
    if (el.id === 'pdf-input') {
      const files = [...(el.files ?? [])];
      el.value = '';
      if (files.length) void importPdfs(files);
      return;
    }
    if (el.id === 'json-input') {
      const file = el.files?.[0];
      el.value = '';
      if (file) void file.text().then(importJson);
      return;
    }
    const c = editing ? find(editing) : undefined;
    const f = el.dataset.f;
    if (!c || !f) return;
    const i = Number(el.dataset.i);
    const k = el.dataset.k;
    const n = Number(el.value);
    let ok = true;

    if (f === 'name') c.name = el.value.trim() || c.name;
    else if (f === 'classes') {
      const parsed = parseClasses(el.value);
      ok = parsed.length > 0;
      if (ok) c.classes = parsed;
    } else if (f === 'size') c.size = el.value as Character['size'];
    else if (f === 'profile') c.profile = el.value as Character['profile'];
    else if (f === 'ac') ok = el.value !== '' && ((c.ac = n), true);
    else if (f === 'maxHp') ok = el.value !== '' && n > 0 && ((c.maxHp = n), true);
    else if (f === 'initiativeBonus') c.initiativeBonus = n || 0;
    else if (f === 'attacksPerAction') c.attacksPerAction = Math.min(4, Math.max(1, Math.floor(n) || 1));
    else if (f.startsWith('ability.')) ok = el.value !== '' && ((c.abilityScores[f.slice(8) as keyof Character['abilityScores']] = n), true);
    else if (f === 'resistances') c.resistances = parseDamageTypes(el.value);
    else if (f === 'vulnerabilities') c.vulnerabilities = parseDamageTypes(el.value);
    else if (f === 'immunities') c.immunities = parseDamageTypes(el.value);
    else if (f === 'conditionImmunities') c.conditionImmunities = parseConditionNames(el.value);
    else if (f === 'slot') {
      if (n > 0) c.slots[i] = Math.floor(n);
      else delete c.slots[i];
      markEdited(c, 'slots');
    } else if (f === 'caster') {
      const k2 = c.spellcasting[i];
      if (k2 && k) (k2 as unknown as Record<string, unknown>)[k] = k === 'ability' ? el.value : n;
    } else if (f === 'spell') {
      const s = c.spells[i];
      if (s) s.inCombat = el.checked;
    } else if (f === 'spellFilter') {
      spellFilter = el.value;
      render();
      root.querySelector<HTMLInputElement>('[data-f="spellFilter"]')?.focus();
      return;
    } else if (f === 'attack') {
      const a = c.attacks[i];
      if (a && k) {
        if (k === 'name') a.name = el.value.trim() || a.name;
        else if (k === 'toHit') ok = el.value !== '' && ((a.toHit = n), true);
        else if (k === 'damage') ok = setAttackDamage(a, el.value);
        else if (k === 'range') a.range = el.value as 'melee' | 'ranged';
      }
    }

    el.classList.toggle('bad', !ok);
    if (!ok) return;
    if (['classes', 'ac', 'maxHp', 'size', 'attacksPerAction', 'name'].includes(f) || f.startsWith('ability.')) markEdited(c, f);
    if (f === 'initiativeBonus') markEdited(c, 'initiative');
    el.closest('.f')?.classList.remove('low', 'missing');
    el.classList.remove('missing');
    changed();
    // Update the card above without re-rendering the form, so Tab keeps working.
    const card = root.querySelector(`[data-card="${CSS.escape(c.id)}"]`);
    if (card) card.querySelector('.card-summary')!.textContent = combatSummary(c);
    const title = root.querySelector('.editor h3');
    if (title) title.textContent = `Review: ${c.name}`;
  });

  render();
  deps.onChange(chars);
  return {
    refresh() {
      render();
      deps.onChange(chars);
    },
  };
}
