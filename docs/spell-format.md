# Spell data format

Spells are stored as JSON objects (`SpellDef`, see `src/data/spellTypes.ts`). The bundled SRD library
(`src/data/srd-spells.json`) is an array of 339 of them.

A spell describes what it *does*. It does not carry a save DC or an attack bonus: those belong to the
caster (the D&D Beyond sheet lists them per spell). `spellToActions` combines the two.

## Fields

| Field | Notes |
|---|---|
| `id`, `name` | `id` is lowercase and hyphenated (`magic-missile`). |
| `level` | 0 for cantrips. |
| `school`, `classes` | Class names as the SRD lists them. |
| `castingTime`, `range`, `components`, `duration` | As printed. `concentration` and `ritual` are derived flags. |
| `text` | The description as plain text, without the scaling paragraphs. |
| `higher`, `cantripUpgrade` | The scaling paragraphs, for display. |
| `effect` | What the simulator uses. Absent for spells it cannot model. |
| `notes` | Why a spell has no `effect`, or which parts of it are not simulated. |

## Effects

An attack (`count` darts, rays or beams, each with its own roll; `autoHit` for Magic Missile):

```json
{ "kind": "attack", "range": "ranged", "damage": [{ "dice": "2d6", "type": "fire" }], "count": 3,
  "scaling": { "upcast": { "above": 2, "count": 1 } } }
```

A saving throw (`area` when it hits every creature in a shape; `halfOnSave` when a success halves it):

```json
{ "kind": "save", "ability": "dex", "damage": [{ "dice": "8d6", "type": "fire" }], "halfOnSave": true,
  "area": { "shape": "sphere", "size": 20 }, "scaling": { "upcast": { "above": 3, "damageDice": "1d6" } } }
```

Healing (`addsModifier` is "plus your spellcasting ability modifier"):

```json
{ "kind": "heal", "dice": "2d8", "addsModifier": true, "scaling": { "upcast": { "above": 1, "healDice": "2d8" } } }
```

Attack and save effects may also carry `effects`, the conditions they inflict, in the same format as
monster actions (`docs/monster-format.md`). In spell data a `repeatSave` or `avoidSave` with `dc: 0`
means "the caster's spell save DC".

## Scaling

- `upcast.above`: the slot level the scaling starts from. `damageDice` is added to the first damage
  component per level above, `count` adds darts or rays, `healDice` adds healing dice.
- `cantrip.damageDice`: one die of that size is added at character levels 5, 11 and 17.
  `cantrip.counts` is the number of beams at levels 1, 5, 11 and 17 (Eldritch Blast: 1, 2, 3, 4).

## Converting a spell for a caster

`spellToActions(spell, { characterLevel, spellAttackBonus, spellSaveDC, spellModifier, slotLevels })`
returns engine actions and heals:

- A cantrip becomes one free action scaled to the character's level.
- A leveled spell becomes one variant per slot level in `slotLevels` at or above the spell's level
  (`Fireball`, `Fireball (level 4)`, ...). The fight engine uses the lowest slot that is still
  available, as the rules for the simulator specify.
- Healing Word and other Bonus Action spells go in the bonus action slot.
- Small areas (cones, cubes and lines of 15 feet or less, spheres of 5 feet) hit at most 2 creatures;
  larger ones use the fight's area-target setting.

## What is not simulated

Spells with no `effect`: reactions (Shield, Counterspell, Hellish Rebuke), casting times over one
action, summons and walls, zones that act when creatures enter or end a turn (Spirit Guardians,
Moonbeam), concentration spells you keep using on later turns (Call Lightning, Vampiric Touch),
smites, buffs on a willing creature (Haste), and spells that offer a menu or table of effects.
Concentration itself is not modelled: concentration spells that are simulated (Hold Person, Phantasmal
Killer) apply their initial effect only, and a caster is not limited to one at a time.
Healing spells heal one creature, including the mass spells. Extra targets at higher slot levels are
ignored.

## Where the SRD data comes from

`npm run data:fetch` downloads the SRD 5.2.1 text (the same Markdown conversion the monsters use) and
`npm run data:build` parses it, failing on any block it cannot read. The damage dice, damage types, save
abilities and healing dice of the 44 simulated damage and healing spells were also checked against an
independently filed copy of the same spells, and agreed on all of them.

SRD 5.2.1 content is copyright Wizards of the Coast LLC and licensed under CC-BY-4.0. The attribution
is shown in the site footer.
