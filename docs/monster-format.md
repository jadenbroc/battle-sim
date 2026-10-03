# Monster data format

Monsters are stored as JSON objects (`MonsterDef`, see `src/data/monsterTypes.ts`). The bundled SRD
library (`src/data/srd-monsters.json`) is an array of them, and custom or imported monsters use the
same shape.

## Fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique, lowercase, hyphenated (`goblin-warrior`). |
| `name`, `size`, `type`, `alignment` | string | `subtype` is optional. |
| `cr` | string | As printed: `"0"`, `"1/8"`, `"1/4"`, `"1/2"`, `"1"` ... |
| `crValue` | number | Numeric CR (`0.125`, `0.25`, `0.5`, `1`, ...). Used for filtering. |
| `xp`, `proficiencyBonus` | number | |
| `ac`, `hp` | number | `hitDice` is display text (`"3d6+3"`). |
| `abilityScores` | object | `str`, `dex`, `con`, `int`, `wis`, `cha` scores. |
| `saveBonuses` | object | Save totals that differ from the ability modifier (proficient saves). |
| `initiativeBonus` | number | On top of the Dexterity modifier. |
| `resistances`, `vulnerabilities`, `immunities` | damage types | Lowercase: `fire`, `slashing`, ... |
| `conditionImmunities` | string[] | Display only until conditions are modelled. |
| `actions` | array | Simulated actions, below. |
| `multiattack` | object | `{ text, parts: [{ action, count }] }`. Optional. |
| `traits`, `bonusActions`, `reactions`, `legendaryActions`, `otherActions` | `{ name, text }[]` | Display only for now. |
| `notes` | string[] | Data-quality notes shown to the user. |

## Actions

An attack:

```json
{ "kind": "attack", "name": "Scimitar",
  "attack": { "name": "Scimitar", "toHit": 4, "damage": [{ "dice": "1d6+2", "type": "slashing" }] } }
```

A save effect (`area: true` hits several enemies, up to the fight's area-target setting):

```json
{ "kind": "save", "name": "Fire Breath", "area": true, "limit": "Recharge 5-6",
  "save": { "name": "Fire Breath", "ability": "dex", "dc": 21, "halfOnSave": true,
            "damage": [{ "dice": "17d6", "type": "fire" }] } }
```

- `damage[].dice` is dice notation (`"2d6+3"`) or a flat number (`"1"`).
- `limit` is the raw usage text (`Recharge 5-6`, `3/Day`). Actions with a `limit` are kept in the data
  but left out of fights until recharge and daily limits are modelled.
- A Multiattack is simulated when every `parts[].action` names an attack in `actions`. Mixed attacks
  (two Claw, one Bite) run in the order listed.

## What the engine does not simulate yet

Traits (Pack Tactics, Nimble Escape), bonus actions, reactions, legendary actions, spellcasting,
limited-use actions, conditions, and effects that are not damage (grapples, frightened, ...). The UI
lists these per monster so the results are not mistaken for a full simulation.

## Where the SRD data comes from

`npm run data:fetch` downloads a Markdown conversion of SRD 5.2.1
([downfallx/dnd-5e-srd-markdown](https://github.com/downfallx/dnd-5e-srd-markdown)) into
`data/srd-raw/` (gitignored). `npm run data:build` parses every stat block into
`src/data/srd-monsters.json` (330 monsters) and fails if a block does not parse or is inconsistent:
ability modifiers must match scores, hit points must match hit dice, and every printed damage
average must match its dice.

Three stat blocks (Ancient Red Dragon, Remorhaz, Will-o'-Wisp) have a scrambled ability table in
the source; their values live in `data/srd-overrides.json`.

An API-based dataset (The DM's Toolkit) was tried first and rejected: it had records with another
monster's actions (Guard, Spider, Cultist, Couatl), wrong ability scores (Troll, Swarm of Insects,
Violet Fungus), missing scores for about a dozen monsters, and extra pre-2024 creatures (Goblin,
Bugbear, Acolyte, ...) that are not in SRD 5.2.1.

SRD 5.2.1 content is copyright Wizards of the Coast LLC and licensed under CC-BY-4.0. The attribution
is shown in the site footer.
