import type { FightConfig } from './engine/fight';
import type { Action, Combatant, HealAction, TargetProfile, Team } from './engine/types';

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

/** Hardcoded demo: a level-3-ish party against four goblins. */
export function sampleFight(goblins = 4): FightConfig {
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

  return { combatants: [fighter, cleric, wizard, ...gobs] };
}
