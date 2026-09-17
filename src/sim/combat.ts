import type { DefStyle, Loadout, MonsterState } from './types';

/**
 * Core OSRS combat rolls.
 *
 * Formulas are the standard ones documented on the OSRS Wiki (originally derived
 * from Bitterkoekje's spreadsheet). Integer truncation points matter and are
 * reproduced exactly - moving a floor() changes max hits by 1.
 */

/** NPC defence roll. Uses the (possibly drained) defence level. */
export const npcDefenceRoll = (defLevel: number, defBonus: number): number =>
  (defLevel + 9) * (defBonus + 64);

/**
 * Probability an attack roll beats a defence roll.
 * This is the standard two-branch accuracy formula.
 */
export const hitChance = (attackRoll: number, defenceRoll: number): number => {
  if (attackRoll > defenceRoll) {
    return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  }
  return attackRoll / (2 * (defenceRoll + 1));
};

/** Which defence bonus a loadout rolls against, given the monster state. */
export const defenceBonusFor = (m: { d: Record<DefStyle, number> }, style: DefStyle): number =>
  m.d[style] ?? 0;

/**
 * Accuracy of a loadout against the current monster state.
 * `styleOverride` lets spec attacks roll against a different defence stat
 * (e.g. godsword specs always roll slash, Arclight rolls stab).
 */
export const accuracy = (
  load: Pick<Loadout, 'attackRoll' | 'defStyle'>,
  monster: { d: Record<DefStyle, number>; meleePunish?: boolean },
  state: MonsterState,
  opts: { styleOverride?: DefStyle; accuracyMultiplier?: number } = {},
): number => {
  const style = opts.styleOverride ?? load.defStyle;
  // Magic defence rolls use the monster's Magic level, not its Defence level.
  const level = style === 'magic' ? state.magic : state.def;
  const roll = Math.trunc(load.attackRoll * (opts.accuracyMultiplier ?? 1));

  let defRoll = npcDefenceRoll(level, defenceBonusFor(monster, style));
  // Doom's melee punish only rewards crush; every other style rolls as normal.
  if (monster.meleePunish && style === 'crush') {
    defRoll = Math.trunc((defRoll * 15) / 100);
  }
  return hitChance(roll, defRoll);
};

/**
 * Mean damage per tick of a loadout against the current monster state,
 * ignoring overkill. Used for the "what would my main weapon have done"
 * opportunity-cost term.
 */
export const dpt = (
  load: Loadout,
  monster: { d: Record<DefStyle, number> },
  state: MonsterState,
): number => (accuracy(load, monster, state) * (load.maxHit / 2)) / load.speed;

/** Convenience: damage per second. */
export const dps = (
  load: Loadout,
  monster: { d: Record<DefStyle, number> },
  state: MonsterState,
): number => dpt(load, monster, state) / 0.6;
