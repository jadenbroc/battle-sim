# DnD Battle Simulator: Spec

## Goal
A browser-only D&D 2024-rules combat simulator. No backend, no AI at runtime. Hostable free as a static site and usable by other people.

## Modes (one shared rules engine)
- **Step-through:** runs one fight and shows the log one action at a time (next / previous / auto-play). Theater of the mind: no grid, no positioning.
- **Bulk:** runs N fights (1,000 to 10,000+) in a Web Worker and reports win rate, average rounds, damage per round per creature, and survival rate per creature.

Both modes call the same engine so results stay consistent.

## Decisions
The engine makes every decision using rule-based tactics profiles. The user does not pick actions during a fight.
- Default profile: attack the lowest-HP enemy, use the best available spell slot, heal an ally below 30% HP.
- Profiles are selectable and tweakable per creature.
- Seeded RNG so any fight can be replayed exactly.

## Monsters
- **Bundled SRD 5.2 monster list** ships as the starting library (searchable, filterable by CR and type).
- **Building an enemy group:** search the list, add monsters with a quantity (e.g. 4x Goblin), remove or change counts. Up to 12 monsters in a group for Milestone 1.
- **Custom monsters:** a form to build one from scratch, or edit a copy of an SRD monster (HP, AC, attacks, saves, resistances). JSON import also works.
- Custom and imported monsters stay in the browser only.
- Each monster has a tactics profile like characters do (default: attack the lowest-HP enemy).

## Tactics profiles (Milestone 1)
Each creature's turn has two separate decisions: which action, then which target. Action choice is shared by everyone; the profile controls targeting.

**Action choice (all creatures)**
- Pick the option with the highest expected damage against the chosen target (hit chance, save DC vs. target's save, crit chance).
- Casters use the lowest slot that gets the job done. Cantrips and at-will attacks are the fallback when slots run out.
- Healing overrides: if the creature has a healing option and an ally is below **30%** of max HP, it heals instead. Downed allies come first.

**Target choice (the profile, set per creature)**
1. **Focus weakest:** enemy with the lowest current HP. **Default for characters.**
2. **Focus biggest threat:** enemy with the highest estimated damage per round from its stat block.
3. **Random:** uniform among valid targets. **Default for monsters.**

**Rules for all profiles**
- Conscious targets come first. Downed characters are attacked only when no conscious target remains.
- Area spells hit up to 3 targets (see Engine rules), preferring those with the most remaining HP.
- Mixed groups are allowed (e.g., a Focus-biggest-threat boss with Random minions).

## Engine rules (Milestone 1)
**Standard 2024 rules**
- **Initiative:** d20 + Dexterity check modifier. Ties break by higher Dex score, then a coin flip.
- **Attacks:** natural 20 is a crit (double damage dice), natural 1 misses. Advantage and disadvantage supported from the start.
- **Saves:** d20 + save modifier vs. DC. No special effect on a natural 20 or 1. Half damage on success where the spell says so.
- **Damage:** resistance, vulnerability, and immunity applied by damage type, in the correct order.
- **Dropping to 0 HP:** monsters die. Characters fall unconscious and roll death saves (10+ succeeds, natural 20 regains 1 HP, natural 1 counts as two failures). Damage while down is a failure (two on a crit). Leftover damage at or above max HP kills instantly. Any healing brings the character back up.
- **Cantrips:** damage scales with character level.

**Simulator decisions (confirmed)**
- **Win condition:** party wins when all enemies are down. Lost when every character is at 0 HP. A 30-round cap counts as a stalemate.
- **Bulk results buckets:** "won, nobody died", "won with deaths", "TPK", and "stalemate".
- **Monster initiative:** each monster rolls individually by default, with an option to group identical monsters under one roll.
- **Area spells (no grid):** hit up to **3** enemies by default, capped at living enemies. The number is a user setting. Self-limiting spells (like Burning Hands) hit fewer.
- **Resources:** fights start at full HP and full spell slots, and no rests occur. **No adventuring-day mode** for now.
- **Spell slot use:** casters use the lowest slot that gets the job done.
- **Not in Milestone 1:** concentration, reactions, opportunity attacks, movement.

## Milestone 1 (smallest useful version)
- Import up to 8 characters from D&D Beyond PDFs, with a review/edit screen.
- Pick an enemy group from the bundled SRD monster list (with quantities).
- One party vs. one monster group.
- Initiative, turn order, attack rolls, saving throws, damage, resistances and immunities, death saves.
- Weapon attacks and basic damage spells, with spell slots.
- Bulk win-rate output plus a step-through log.

## Conditions (implemented)
All 14 conditions plus Exhaustion levels follow the 2024 rules, read from the filed rules in
`_shared\knowledge\conditions\`. Rulings for a fight with no grid:
- **Within 5 feet** is decided by attack type: melee attacks are, ranged attacks are not. So a Prone
  target gives melee attackers advantage and ranged attackers disadvantage, and a melee hit on a
  Paralyzed or Unconscious target is a critical hit.
- A Frightened creature's source of fear is assumed to be in line of sight. Movement effects (Speed 0,
  being dragged) have no effect. A Prone creature stands up at the start of its turn unless it is
  Grappled, Restrained, Paralyzed, Petrified or Unconscious.
- A character at 0 HP counts as Unconscious (attacks against it have advantage, melee hits crit).
- A creature that is Restrained by a grapple spends its action trying to escape (best of Str/Dex
  modifier against the escape DC). A merely Grappled creature fights on, with disadvantage against
  anyone but the grappler. A grapple ends when the grappler is incapacitated or dead.
- Action choice stays "highest expected damage" (now counting advantage, automatic crits and
  exhaustion). Conditions an action inflicts are not scored: testing showed that preferring a weaker
  attack for the chance of a condition makes monsters worse.
- Not yet: concentration, Surprised (a turn-order rule, not a condition), and the Incapacitated clause
  about speech.

## Spell data (implemented)
The bundled SRD 5.2.1 spell library (339 spells) lives in `src/data/srd-spells.json`, built by
`npm run data:build`; see `docs/spell-format.md`. A spell stores what it does (attack, save, heal, the
conditions it inflicts, and how it scales); the caster supplies the save DC, attack bonus and
spellcasting modifier, which the PDF import will read from the character sheet.
- 41 damaging spells and 5 healing spells are simulated. Spells with no effect (reactions, summons,
  walls, zones such as Spirit Guardians, concentration spells used on later turns, smites, buffs on a
  willing creature, spells with a menu of effects) carry a note saying why.
- Higher slots scale damage, healing and the number of darts and rays; cantrips scale at character
  levels 5, 11 and 17. Casters use the lowest slot that is available.
- Magic Missile darts hit automatically (no attack roll, so no crit).
- Small areas (15 feet or less, or a 5-foot sphere) hit at most 2 creatures; larger ones use the
  fight's area-target setting.
- Not yet: concentration (so concentration spells apply their initial effect only, and a caster may
  have several going), extra targets from higher slots, and healing more than one creature.

## Later milestones
1. Concentration.
2. Weapon mastery properties.
3. Reactions, legendary actions, recharge abilities.
4. More tactics profiles, shareable fight setups via URL.

## Data and licensing
- **Source of truth: dndbeyond.com.** All game content (spells, monsters, classes, conditions, weapon mastery) comes from D&D Beyond, following the 2024 rules. The author's library in `C:\AI Ecosystem\_shared\knowledge\` is built from D&D Beyond pages by the library skills (for example each spell file cites its D&D Beyond page), and the simulator reads that library. The private build writes only entries missing from the SRD bundle; where both have an entry, the SRD copy wins and the build reports any differences as a check.
- **Two layers:** the public site bundles the **SRD 5.2.1** subset (CC-BY 4.0, with required attribution in the site footer) **plus the author's 213 non-SRD spells**, which the author explicitly chose to ship in the default spell list (`src/data/book-spells.json`, built by `npm run data:book-spells`; the footer says they are not SRD content). This reverses the earlier SRD-only rule for spells and knowingly republishes book content, which is the author's decision and risk. Monsters, and everything else in the author's full library, stay private (see below) and are never deployed. A spell "not in the SRD library" means it is missing from the public bundle, not that D&D Beyond lacks it.
- Users can **import their own data** (JSON, plus a documented format) for characters, monsters, spells, and items. Imported data stays in the user's browser.
- **Character import from D&D Beyond PDF:** users upload the character sheet PDF exported from D&D Beyond (e.g. `{character}.pdf`). Parsing happens entirely in the browser (pdf.js, reading the sheet's fillable form fields; see "PDF format findings" below), so no file is ever uploaded to a server.
  - Up to **8 characters** can be loaded at once (the party cap).
  - Each import is shown in a review screen (ability scores, AC, HP, attacks, spell DCs, resistances, features) so the user can correct anything the parser got wrong before it is used.
  - Fields the parser can't read reliably can be filled in or overridden by hand.
  - A manual character form and JSON import are the fallbacks if a PDF fails to parse.
  - Imported characters are kept in the browser (local storage) only.
- The author's personal markdown library (characters, monsters, spells, conditions, weapon mastery) is converted to JSON by a build script for private use only. That output is gitignored and never deployed. Built with `npm run data:private`; served by a dev-only Vite middleware or loaded through "Load private data" into IndexedDB. See `docs/private-data.md`.

## PDF format findings (from 4 real exports)
Test files live in `projects\battle-sim\test characters\`: Lady Moonfire (Cleric 4), Curuvar the Brazen (Wizard 4), Haydon Hallowedridge (Paladin 4), Lucien Kaelis (Cleric 1 / Wizard 3, multiclass). Four PDFs is a small sample, so the parser must fail soft.

**Structure**
- 4 to 6 pages. **The sheets are fillable forms.** (An earlier version of this note said there were no form fields. That was wrong: pdf.js text extraction returns only the printed labels, but the character data is in named Widget fields, which `page.getAnnotations()` returns.) The parser reads those fields by name: `CharacterName`, `CLASS  LEVEL`, `STR`, `ST Strength`, `AC`, `MaxHP`, `Total` (hit dice), `Init`, `Defenses`, `SIZE`, `Wpn Name` / `Wpn1 AtkBonus` / `Wpn1 Damage` / `Wpn Notes 1`, and on the spell pages `spellName0`, `spellSource0`, `spellSaveHit0`, `spellCastingTime0`, `spellPrepared0`, `spellPage0`, `spellHeader0`, `spellSlotHeader0`, `spellCastingClass0`, `spellCastingAbility0`, `spellSaveDC0`, `spellAtkBonus0`. Some names have stray spaces (`Wpn2 AtkBonus `, `CLASS  LEVEL`), which are normalized.
- Spell levels are not a field: each spell sits under a section header field (`=== 1st LEVEL ===`), so a spell's level is that of the last header above it by position (page, then y), and a second spell page with no header of its own continues the last section. Page count varies, so never rely on page numbers.
- A PDF with no such fields (not a D&D Beyond sheet, or a changed layout) is reported as unreadable and the user is pointed to the manual form.

**Readable directly from the PDF**
- Name, species, background, class and level (`Cleric 1 / Wizard 3` for multiclass).
- Six ability scores and modifiers, saving throw modifiers (proficient saves are marked with a bullet), skill modifiers (proficient skills marked `P`), proficiency bonus, initiative, AC, max HP, speed, passive scores.
- Hit dice (`4d8`, or `1d8 + 3d6` for multiclass).
- Defenses box: lines like `Resistances - Necrotic` and `Immunities - Disease`. It also lists non-damage entries (`Immunities - Magical Sleep`), so only entries that match damage types should become resistances or immunities.
- **Attacks table** (weapons and cantrips): name, to-hit bonus, damage as dice plus modifier and type (`1d6+4 Bludgeoning`), and notes. Notes carry weapon properties and the mastery (`Simple, Versatile, Topple`). Cantrip damage is already scaled for character level. This means weapon and cantrip attacks need no lookup.
- **Spell tables**: name, source, save or attack (`WIS 14`, `+6`, or `--`), casting time (`1A`, `1BA`, `1R`), range, components, duration, and slot counts per level (`4 Slots OOOO`). The save DC is given per spell (the multiclass sheet shows `CON 12` for a Cleric spell and `CON 14` for a Wizard spell), so the parser never has to compute DCs.
- Class features and species traits as names with description text, for display on the review screen.

**Not in the PDF (must come from elsewhere)**
- **Spell damage, healing, scaling and effects.** Only the name and save/attack type are listed. Damage dice and upcast scaling come from the spell data, matched by name: the bundled SRD spells, plus the author's private library (built from D&D Beyond) when loaded. Spells in neither (for example Toll the Dead, Word of Radiance and Mind Sliver in these samples are in the author's library but not the SRD) are listed on the review screen, or are skipped by the engine with a visible warning, until private data is loaded.
- Class feature mechanics (Divine Smite, Lay on Hands, Channel Divinity). Out of scope for Milestone 1: they are read as names only.
- Current HP is blank in all four sheets. The parser assumes full HP.

**Gotchas the parser must handle**
- **Prepared spells are not reliable.** All four show a hollow circle for every listed spell, and `P` only for always-prepared spells. The Cleric sheet lists the entire class spell list while the Wizard sheet lists a short list, so "prepared" cannot be told from "available". The review screen must let the user tick which spells the character uses in combat, with a sensible default (always-prepared spells plus the highest-damage options).
- **Duplicate spells across rules versions.** The Cleric lists some spells twice, as `PHB` (2014) and `PHB-2024`, with different mechanics (Inflict Wounds is a melee attack roll in 2014 and a CON save in 2024). Deduplicate by name and prefer the 2024 version.
- **Mixed sources.** The same sheet can carry 2014 features, 2024 spells, and other books (`EE`, `XGtE`, `AU`). Species names like `Half-Elf` and `Variant Human` are 2014-style.
- **Multiclass.** Spell tables are split into one section per class pair. Slots are shown once, in the first section, as a shared pool. The `Source` column also names features that grant spells (`Magic Initiate (Wizard)`, `Necromancy Savant`, `Fighting Style (Always Prepared)`).
- Spells with `[R]` are rituals. They matter little in combat and can be ignored by the engine.
- Long text columns (duration, notes) can be clipped in the layout, so the parser should not depend on them.

**Parser requirements**
- Output one normalized character object with a **confidence flag per field**, and show low-confidence fields highlighted on the review screen.
- If a required field (class and level, ability scores, AC, max HP, at least one attack or spell) can't be read, show a clear message and fall back to the manual form instead of guessing.
- Use the four sample PDFs as test fixtures, with expected values recorded in the tests (name, class and level, AC, max HP, ability scores, attacks, spell slot counts).
- **Privacy of fixtures:** the PDFs contain a D&D Beyond player name and non-SRD content. Keep them in a gitignored folder and never commit them to a public repository. The tests should use small synthetic text fixtures derived from them, with names replaced.

## Tech
- TypeScript + Vite, static build, no server.
- Web Worker for bulk runs.
- Unit tests for the rules engine (dice, attacks, saves, damage, conditions) from the start.
- Hosting: GitHub Pages or Netlify.

## Character import (implemented)
`src/character/` reads the sheet (`pdfFields.ts`, `parseCharacterSheet.ts`), picks default combat
spells (`combatSpells.ts`), and converts a character to a combatant (`toCombatant.ts`). The party
panel (`src/ui/partyPanel.ts`) imports up to 8 PDFs, shows a review screen with unclear fields
highlighted and editable, and keeps the party in local storage. Fallbacks: add by hand, JSON import
and export (`docs/character-format.md`).
- Duplicate spells (2014 and 2024 versions, or one spell under two names such as "Melf's Acid Arrow"
  and "Acid Arrow") are merged, preferring 2024. The SRD level wins over the sheet's header.
- Each spell uses its own save DC or attack bonus from the sheet; healing uses the casting class's
  ability modifier (the class named in the spell's source, e.g. `Magic Initiate (Wizard)`).
- Default combat spells: the two best damage cantrips, the four best damage spells and two best heals
  the character has slots for, and always-prepared spells that have a simulated effect. The review
  screen lets the user tick others.
- Extra Attack is inferred from the features text (2 attacks, 3 for a Fighter 11, 4 for a Fighter 20)
  and flagged for checking.
- Spells that list a save or an attack bonus but are not in the SRD library (Toll the Dead, Mind
  Sliver, ...) are reported on the review screen and are not simulated unless private data is loaded
  (`npm run data:private`, then "Load private data"; see `docs/private-data.md`), which supplies them
  from the author's D&D Beyond-sourced library.
- Not simulated: class feature mechanics (Divine Smite, Lay on Hands, Channel Divinity), weapon
  mastery, and any spell the SRD library lacks.

## Open items
- PDF parser: still missing sample sheets with a martial character that has Extra Attack and two
  weapons, and one with damage vulnerabilities, so those cases are only tested with synthetic sheets.
  D&D Beyond can change its PDF layout; an unreadable sheet falls back to the manual form.
- Private data: the path exists (`npm run data:private`). Still to confirm: that the four sample sheets' non-SRD spells (Toll the Dead, Word of Radiance, Thunderclap, Mind Sliver, Infestation, Wither and Bloom, Witch Bolt, the smites, and others) all resolve with a simulated effect once it is loaded, and that the spell library stays the single place new spells are filed.
- Class features that are not in the SRD (the author's own books) still have no data path.
- Project name.

## Handoff to Claude Code
Save this file in the project folder (or rename it `CLAUDE.md`) so Claude Code reads it every session. First task there: scaffold the Vite + TypeScript project, then build the dice/RNG module and its tests.
