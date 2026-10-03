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

A save effect (`area: true` hits several enemies, up to the fight's area-target setting), here a
recharge ability:

```json
{ "kind": "save", "name": "Fire Breath", "area": true, "limit": { "kind": "recharge", "min": 5 },
  "save": { "name": "Fire Breath", "ability": "dex", "dc": 21, "halfOnSave": true,
            "damage": [{ "dice": "17d6", "type": "fire" }] } }
```

- `damage[].dice` is dice notation (`"2d6+3"`) or a flat number (`"1"`).
- `limit` is optional. `{ "kind": "recharge", "min": 5 }` means "Recharge 5-6": available at the
  start of a fight; once used, the creature rolls a d6 at the start of each of its turns and the
  ability returns on `min` or higher. `{ "kind": "perDay", "uses": 3 }` means 3 uses per fight (there
  are no rests inside a fight; "Recharges after a Short or Long Rest" is 1 use).
- `bonus: true` puts the action in the bonus action slot. A creature takes one action and one bonus
  action per turn.
- `attack.range: "ranged"` marks ranged attacks (default melee). Melee attacks count as within 5 feet
  of the target, which matters for Prone targets and for automatic crits.
- `attack.effects` / `save.effects` list the conditions inflicted on a hit / a failed save:

  ```json
  { "condition": "grappled", "duration": { "kind": "indefinite" }, "maxSize": "large", "escapeDc": 14 }
  { "condition": "poisoned", "duration": { "kind": "endOfTargetNextTurn" }, "avoidSave": { "ability": "con", "dc": 12 } }
  { "condition": "frightened", "duration": { "kind": "endOfSourceNextTurn" }, "repeatSave": { "ability": "wis", "dc": 13 } }
  { "condition": "restrained", "duration": { "kind": "while", "condition": "grappled" } }
  ```

  `condition` is one of the 14 conditions (lowercase). `duration.kind` is `indefinite`,
  `endOfTargetNextTurn`, `startOfSourceNextTurn`, `endOfSourceNextTurn`, `rounds` (with `n`; 1 minute
  is 10 rounds), or `while` (lasts while another condition from the same source does). `maxSize`
  limits the effect to creatures of that size or smaller, `avoidSave` lets the target save to avoid
  it, `repeatSave` lets it repeat the save at the end of each of its turns, and `escapeDc` is a
  grapple's escape DC.
- `targetRequires` names a condition the target must already have (`"prone"` for Trample): the action
  is only used on such targets.
- A Multiattack is simulated when every `parts[].action` names an unlimited, non-bonus attack in
  `actions`. Mixed attacks (two Claw, one Bite) run in the order listed; "two attacks, using A or B in
  any combination" uses whichever option has the higher average damage.
- Swallow, Engulf and possession-style actions are not simulated (they change a creature's whole
  state); they stay in `otherActions` / `bonusActions` as text. So do staged effects ("First Failure",
  "Failure by 5 or More") and outcomes that depend on the target's hit points.
- A condition-only action (no damage, such as a Cloaker's Moan) is parsed but never chosen: monsters
  pick the action with the highest expected damage, because choosing a weaker attack for the chance
  of a condition made monsters worse in testing.

## What the engine does not simulate yet

Traits (Pack Tactics, Nimble Escape), reactions, legendary actions and lair actions, spellcasting,
concentration, movement and positioning, and the effects listed above. The UI lists these per
monster so the results are not mistaken for a full simulation.

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
