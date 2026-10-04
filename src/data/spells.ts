import { parseDice } from '../engine/dice';
import type { Ability, Action, BuffAction, AttackAction, ConditionEffect, DamageComponent, HealAction, SaveAction } from '../engine/types';
import type { SpellArea, SpellDef, SpellScaling } from './spellTypes';

/** Loads the bundled SRD 5.2 spell library (split into its own chunk). */
export async function loadSrdSpells(): Promise<SpellDef[]> {
  const mod = await import('./srd-spells.json');
  return mod.default as unknown as SpellDef[];
}

/** Loads the bundled spells from the author's own books (not in the SRD), split into its own chunk. */
export async function loadBookSpells(): Promise<SpellDef[]> {
  const mod = await import('./book-spells.json');
  return mod.default as unknown as SpellDef[];
}

// ----- Search and filter -----

export interface SpellFilter {
  query?: string;
  level?: number;
  /** Class name, e.g. "Wizard". */
  className?: string;
  /** Only spells the simulator can use. */
  simulated?: boolean;
}

export function searchSpells(spells: readonly SpellDef[], f: SpellFilter = {}): SpellDef[] {
  const q = f.query?.trim().toLowerCase();
  const cls = f.className?.toLowerCase();
  return spells.filter(
    (s) =>
      (!q || s.name.toLowerCase().includes(q)) &&
      (f.level === undefined || s.level === f.level) &&
      (!cls || s.classes.some((c) => c.toLowerCase() === cls)) &&
      (!f.simulated || s.effect !== undefined),
  );
}

// ----- Spell -> engine actions -----

/** Character levels at which cantrips grow. */
export const CANTRIP_TIERS = [5, 11, 17] as const;

/** What the caster brings to a spell: its save DC, attack bonus and ability modifier. */
export interface CasterContext {
  characterLevel: number;
  spellAttackBonus: number;
  spellSaveDC: number;
  /** Spellcasting ability modifier (added to healing). */
  spellModifier: number;
  /** Spell slot levels the caster has, so upcast variants can be made. Default: the spell's own level. */
  slotLevels?: number[];
}

export interface ConvertedSpell {
  actions: Action[];
  heals: HealAction[];
  /** Buffs on allies (Bless). */
  buffs: BuffAction[];
  /** Why a spell was not converted, or which parts of it are not simulated. */
  warnings: string[];
}

/** Add `times` copies of `extra` (e.g. "1d6") to a damage component list, merging same-size dice. */
export function addDice(damage: readonly DamageComponent[], extra: string, times: number): DamageComponent[] {
  if (times <= 0 || damage.length === 0) return [...damage];
  const add = parseDice(extra);
  const [first, ...rest] = damage;
  const base = parseDice(first!.dice);
  if (base.sides === add.sides) {
    const mod = base.modifier === 0 ? '' : base.modifier > 0 ? `+${base.modifier}` : `${base.modifier}`;
    return [{ type: first!.type, dice: `${base.count + add.count * times}d${base.sides}${mod}` }, ...rest];
  }
  return [first!, { type: first!.type, dice: `${add.count * times}d${add.sides}` }, ...rest];
}

/** Sum the same-size dice of a healing expression: "2d8" + 2 x "2d8" -> "6d8". */
function addHealDice(dice: string, extra: string, times: number): string {
  if (times <= 0) return dice;
  const base = parseDice(dice);
  const add = parseDice(extra);
  if (base.sides !== add.sides) return dice;
  return `${base.count + add.count * times}d${base.sides}${base.modifier ? (base.modifier > 0 ? '+' : '') + base.modifier : ''}`;
}

/** Chance that at least two of the dice in an expression such as "3d8" show the same number. */
export function matchChance(dice: string): number {
  const { count, sides } = parseDice(dice);
  let allDifferent = 1;
  for (let i = 0; i < count; i++) allDifferent *= Math.max(0, sides - i) / sides;
  return 1 - allDifferent;
}

/** Which of the cantrip's three upgrades (levels 5, 11, 17) the character has reached. */
export function cantripTier(characterLevel: number): number {
  return CANTRIP_TIERS.filter((l) => characterLevel >= l).length;
}

/** Cone, cube, line and sphere spells with a small area hit only a couple of creatures. */
export function areaMaxTargets(area: SpellArea | undefined): number | undefined {
  if (!area) return undefined;
  if (area.shape === 'sphere' || area.shape === 'cylinder' || area.shape === 'emanation') return area.size <= 5 ? 2 : undefined;
  return area.size <= 15 ? 2 : undefined;
}

function resolveEffects(effects: readonly ConditionEffect[] | undefined, dc: number): ConditionEffect[] | undefined {
  if (!effects?.length) return undefined;
  // In spell data a save DC of 0 means "the caster's spell save DC".
  const fix = (s: { ability: Ability; dc: number }) => ({ ...s, dc: s.dc || dc });
  return effects.map((e) => ({
    ...e,
    ...(e.repeatSave ? { repeatSave: fix(e.repeatSave) } : {}),
    ...(e.avoidSave ? { avoidSave: fix(e.avoidSave) } : {}),
  }));
}

function scalingFor(s: SpellScaling | undefined, spellLevel: number, slot: number, charLevel: number) {
  const tier = spellLevel === 0 ? cantripTier(charLevel) : 0;
  const over = spellLevel === 0 ? 0 : Math.max(0, slot - (s?.upcast?.above ?? spellLevel));
  return {
    /** Extra damage dice from cantrip tiers or higher slots, as [dice, times] pairs. */
    damage: [
      ...(s?.cantrip?.damageDice ? [[s.cantrip.damageDice, tier] as const] : []),
      ...(s?.upcast?.damageDice ? [[s.upcast.damageDice, over] as const] : []),
    ],
    /** Beams at this character level (an absolute number, e.g. Eldritch Blast: 1, 2, 3, 4). */
    beams: s?.cantrip?.counts?.[tier],
    /** Extra darts or rays from a higher slot, on top of the spell's own count. */
    extraCount: s?.upcast?.count ? over * s.upcast.count : 0,
    heal: s?.upcast?.healDice ? ([s.upcast.healDice, over] as const) : undefined,
    /** Extra creatures affected by a higher slot (Bane). */
    extraTargets: s?.upcast?.targets ? over * s.upcast.targets : 0,
    over,
  };
}

/**
 * Turn a spell into engine actions: one per spell slot level the caster can use (higher slots
 * scale the spell), or a single action for a cantrip scaled to the character's level. Spells with
 * no simulated effect return nothing and a warning.
 */
export function spellToActions(spell: SpellDef, ctx: CasterContext): ConvertedSpell {
  const out: ConvertedSpell = { actions: [], heals: [], buffs: [], warnings: [] };
  const effect = spell.effect;
  if (!effect) {
    out.warnings.push(`${spell.name}: not simulated${spell.notes[0] ? ` (${spell.notes[0]})` : ''}`);
    return out;
  }
  for (const n of spell.notes) out.warnings.push(`${spell.name}: ${n}`);

  const slots = spell.level === 0 ? [0] : [...new Set(ctx.slotLevels ?? [spell.level])].filter((l) => l >= spell.level).sort((a, b) => a - b);
  const bonus = /^Bonus Action/i.test(spell.castingTime);

  for (const slot of slots) {
    const sc = scalingFor(effect.scaling, spell.level, slot, ctx.characterLevel);
    const name = slot > spell.level && spell.level > 0 ? `${spell.name} (level ${slot})` : spell.name;
    const conc = spell.concentration ? { concentration: true as const } : {};
    const common = { name, spell: spell.name, ...(slot > 0 ? { slotLevel: slot } : {}), ...(bonus ? { bonus: true as const } : {}), ...conc };

    if (effect.kind === 'heal') {
      let dice = effect.dice;
      if (sc.heal) dice = addHealDice(dice, sc.heal[0], sc.heal[1]);
      if (effect.addsModifier && ctx.spellModifier !== 0) dice += ctx.spellModifier > 0 ? `+${ctx.spellModifier}` : `${ctx.spellModifier}`;
      out.heals.push({ ...common, dice });
      continue;
    }

    if (effect.kind === 'buff') {
      out.buffs.push({ ...common, rollModifier: effect.rollModifier, maxTargets: effect.targets + sc.extraTargets });
      continue;
    }

    let damage: DamageComponent[] = effect.damage.map((d) => ({ ...d }));
    for (const [dice, times] of sc.damage) damage = addDice(damage, dice, times);

    if (effect.kind === 'attack') {
      const count = sc.beams ?? (effect.count ?? 1) + sc.extraCount;
      const action: AttackAction = {
        ...common,
        kind: 'attack',
        attack: {
          name: spell.name,
          toHit: ctx.spellAttackBonus,
          damage,
          range: effect.range,
          ...(effect.autoHit ? { autoHit: true } : {}),
          ...(effect.damageTypes ? { damageTypes: effect.damageTypes } : {}),
          ...conc,
          ...(effect.effects ? { effects: resolveEffects(effect.effects, ctx.spellSaveDC) } : {}),
        },
        ...(count > 1 ? { count } : {}),
        ...(effect.leaps ? { leap: { chance: matchChance(damage[0]!.dice), max: slot } } : {}),
      };
      out.actions.push(action);
    } else {
      const chosen = effect.targets ? effect.targets + sc.extraTargets : undefined;
      const maxTargets = chosen ?? areaMaxTargets(effect.area);
      const action: SaveAction = {
        ...common,
        kind: 'save',
        save: {
          name: spell.name,
          ability: effect.ability,
          dc: ctx.spellSaveDC,
          damage,
          halfOnSave: effect.halfOnSave,
          ...(effect.rollModifier ? { rollModifier: effect.rollModifier } : {}),
          ...conc,
          ...(effect.effects ? { effects: resolveEffects(effect.effects, ctx.spellSaveDC) } : {}),
        },
        ...(effect.area || chosen ? { area: true } : {}),
        ...(maxTargets ? { maxTargets } : {}),
      };
      out.actions.push(action);
    }
  }
  return out;
}

/** Convert several spells at once, collecting actions, heals and warnings. */
export function spellsToActions(spells: readonly SpellDef[], ctx: CasterContext): ConvertedSpell {
  const out: ConvertedSpell = { actions: [], heals: [], buffs: [], warnings: [] };
  for (const s of spells) {
    const c = spellToActions(s, ctx);
    out.actions.push(...c.actions);
    out.heals.push(...c.heals);
    out.buffs.push(...c.buffs);
    out.warnings.push(...c.warnings);
  }
  return out;
}
