import { totalLevel, type Character } from './characterTypes';

/** One line for the party list: class and level, AC, HP. */
export function combatSummary(c: Character): string {
  const classes = c.classes.map((k) => `${k.name} ${k.level}`).join(' / ') || 'no class';
  const ac = Number.isFinite(c.ac) ? `AC ${c.ac}` : 'AC ?';
  const hp = Number.isFinite(c.maxHp) ? `HP ${c.maxHp}` : 'HP ?';
  return `${classes} · level ${totalLevel(c)} · ${ac} · ${hp}`;
}
