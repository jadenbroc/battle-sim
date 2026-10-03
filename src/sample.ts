import type { FightConfig } from './engine/fight';
import type { Action, Combatant, HealAction, TargetProfile, Team } from './engine/types';
import type { SpellDef } from './data/spellTypes';
import { spellsToActions, type CasterContext } from './data/spells';

interface Spec {
  id: string;
  name: string;
  team: Team;
  hp: number;
  ac: number;
  dex: number;
  actions: Action[];
  heals?: HealAction[];
  slots?: Record<number, number>;
  profile?: TargetProfile;
  groupKey?: string;
}

function make(s: Spec): Combatant {
  return {
    creature: {
      id: s.id,
      name: s.name,
      kind: s.team === 'party' ? 'character' : 'monster',
      abilityScores: { str: 10, dex: s.dex, con: 10, int: 10, wis: 10, cha: 10 },
      saveBonuses: {},
      ac: s.ac,
      maxHp: s.hp,
      hp: s.hp,
      status: 'alive',
      deathSaves: { successes: 0, failures: 0 },
      resistances: [],
      vulnerabilities: [],
      immunities: [],
    },
    team: s.team,
    profile: s.profile ?? (s.team === 'party' ? 'weakest' : 'random'),
    actions: s.actions,
    heals: s.heals ?? [],
    slots: s.slots ?? {},
    groupKey: s.groupKey,
  };
}

/** Spells the demo casters know, by spell id (a level 3 Cleric and Wizard). */
const CLERIC_SPELLS = ['sacred-flame', 'guiding-bolt', 'cure-wounds', 'healing-word'];
const WIZARD_SPELLS = ['fire-bolt', 'magic-missile', 'burning-hands', 'scorching-ray'];
const CASTER: Omit<CasterContext, 'slotLevels'> = { characterLevel: 3, spellAttackBonus: 5, spellSaveDC: 13, spellModifier: 3 };

/**
 * Demo party: a level-3-ish Fighter, Cleric and Wizard. Pass the SRD spell library and the casters
 * use real spells (damage, scaling and upcasting from the data); without it they use fixed numbers.
 */
export function sampleParty(spells?: readonly SpellDef[]): Combatant[] {
  const fighter = make({
    id: 'fighter',
    name: 'Fighter',
    team: 'party',
    hp: 28,
    ac: 18,
    dex: 12,
    actions: [
      { kind: 'attack', name: 'Longsword', attack: { name: 'Longsword', toHit: 5, damage: [{ dice: '1d8+3', type: 'slashing' }] } },
    ],
  });

  const cleric = make({
    id: 'cleric',
    name: 'Cleric',
    team: 'party',
    hp: 24,
    ac: 16,
    dex: 10,
    slots: { 1: 4, 2: 2 },
    actions: [
      { kind: 'attack', name: 'Mace', attack: { name: 'Mace', toHit: 4, damage: [{ dice: '1d6+2', type: 'bludgeoning' }] } },
      {
        kind: 'save',
        name: 'Sacred Flame',
        save: { name: 'Sacred Flame', ability: 'dex', dc: 13, halfOnSave: false, damage: [{ dice: '1d8', type: 'radiant' }] },
      },
    ],
    heals: [
      { name: 'Cure Wounds', spell: 'Cure Wounds', slotLevel: 1, dice: '1d8+3' },
      { name: 'Cure Wounds (2nd)', spell: 'Cure Wounds', slotLevel: 2, dice: '2d8+3' },
    ],
  });

  const wizard = make({
    id: 'wizard',
    name: 'Wizard',
    team: 'party',
    hp: 17,
    ac: 12,
    dex: 14,
    slots: { 1: 4, 2: 2 },
    actions: [
      { kind: 'attack', name: 'Fire Bolt', attack: { name: 'Fire Bolt', toHit: 5, damage: [{ dice: '1d10', type: 'fire' }] } },
      {
        kind: 'save',
        name: 'Burning Hands',
        spell: 'Burning Hands',
        slotLevel: 1,
        area: true,
        maxTargets: 2,
        save: { name: 'Burning Hands', ability: 'dex', dc: 13, halfOnSave: true, damage: [{ dice: '3d6', type: 'fire' }] },
      },
      {
        kind: 'save',
        name: 'Burning Hands (2nd)',
        spell: 'Burning Hands',
        slotLevel: 2,
        area: true,
        maxTargets: 2,
        save: { name: 'Burning Hands', ability: 'dex', dc: 13, halfOnSave: true, damage: [{ dice: '4d6', type: 'fire' }] },
      },
    ],
  });

  if (spells) {
    const pick = (ids: string[]): SpellDef[] => ids.flatMap((id) => spells.find((s) => s.id === id) ?? []);
    const cast = (ids: string[]) => spellsToActions(pick(ids), { ...CASTER, slotLevels: [1, 2] });

    const c = cast(CLERIC_SPELLS);
    cleric.actions = [cleric.actions[0]!, ...c.actions]; // keeps the mace
    cleric.heals = c.heals;

    wizard.actions = cast(WIZARD_SPELLS).actions;
  }

  return [fighter, cleric, wizard];
}

/** Hardcoded demo: the sample party against hand-built goblins (used by tests). */
export function sampleFight(goblins = 4): FightConfig {
  const gobs = Array.from({ length: goblins }, (_, i) =>
    make({
      id: `goblin${i + 1}`,
      name: `Goblin ${i + 1}`,
      team: 'enemies',
      hp: 7,
      ac: 15,
      dex: 14,
      groupKey: 'Goblin',
      actions: [
        { kind: 'attack', name: 'Scimitar', attack: { name: 'Scimitar', toHit: 4, damage: [{ dice: '1d6+2', type: 'slashing' }] } },
      ],
    }),
  );

  return { combatants: [...sampleParty(), ...gobs] };
}
