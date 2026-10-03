# Character format

A character is a JSON object (`Character`, see `src/character/characterTypes.ts`). It is what the PDF
importer produces, what the review screen edits, what is kept in local storage, and what "Import JSON"
and "Export JSON" read and write. A hand-written file can be much shorter: only the first group below is
required.

## Required

| Field | Notes |
|---|---|
| `name` | |
| `classes` | `[{ "name": "Cleric", "level": 4 }]`. More than one entry for a multiclass. |
| `abilityScores` | `str`, `dex`, `con`, `int`, `wis`, `cha` as numbers. |
| `ac` | Armor Class. |
| `maxHp` | Greater than 0. The character starts a fight at full HP. |

## Optional (with defaults)

| Field | Default |
|---|---|
| `id` | The name as a lowercase slug. |
| `species`, `background`, `hitDice`, `speed`, `features` | Empty text. |
| `saveBonuses` | `{}`. Saving throw totals that differ from the plain ability modifier, e.g. `{ "wis": 6 }`. |
| `proficiencyBonus` | 2 |
| `initiativeBonus` | 0. On top of the Dexterity modifier. |
| `size` | `"medium"`. Matters for size-limited effects such as "a Large or smaller creature". |
| `resistances`, `vulnerabilities`, `immunities` | `[]`. Damage types such as `"fire"`. |
| `conditionImmunities` | `[]`. Conditions such as `"charmed"`. |
| `attacks` | `[]`. See below. |
| `attacksPerAction` | 1. Extra Attack: 2, 3 or 4. Applies to attacks with `weapon: true`. |
| `profile` | `"weakest"`. Who the character targets: `weakest`, `threat` or `random`. |
| `spellcasting` | `[]`. See below. |
| `spells` | `[]`. See below. |
| `slots` | `{}`. Spell slots by level, `{ "1": 4, "2": 3 }`. |

## Attacks

```json
{ "name": "Rapier", "toHit": 5, "damage": [{ "dice": "1d8+3", "type": "piercing" }],
  "range": "melee", "weapon": true, "notes": "Martial, Finesse" }
```

`damage` is a non-empty list of `{ dice, type }` (dice such as `"2d6+1"` or a flat `"5"`). `range` is
`melee` or `ranged` and `weapon` defaults to true. Spells do not belong here: list them under `spells`.

## Spellcasting and spells

```json
"spellcasting": [{ "name": "Wizard", "ability": "int", "saveDC": 14, "attackBonus": 6 }],
"spells": [{ "name": "Fireball", "source": "Wizard", "level": 3, "inCombat": true,
             "save": { "ability": "dex", "dc": 14 } }]
```

`spellcasting` gives the save DC, attack bonus and ability of each casting class. A spell with
`inCombat: true` is matched by name to the SRD spell library (a possessive prefix is dropped, so
"Tasha's Hideous Laughter" finds "Hideous Laughter") and cast with the numbers of the class named in its
`source`. A spell can carry its own `save` (`{ ability, dc }`) or `attackBonus`, which win over the
class's. Spells that are not in the library are listed with a warning and not simulated.

## Importing a sheet

D&D Beyond character sheet PDFs are fillable forms; the importer reads their named fields (see
`CLAUDE.md`, "PDF format findings"). Everything is read in the browser. Values it is unsure about are
highlighted on the review screen, and a character with a required field missing is kept out of the
fight until it is fixed. `confidence` and `warnings` in the JSON record what the importer noticed; they
are optional.
