import type { AttackType, DefStyle, Loadout } from './types';

/**
 * Turns levels + boosts + prayers + equipment bonuses into the three numbers the
 * simulator needs: attack roll, max hit, and speed.
 *
 * Truncation points are load-bearing here - OSRS floors after the prayer
 * multiplier and again after the void multiplier, and moving either shifts max
 * hits by 1.
 */

export interface CombatLevels {
  attack: number;
  strength: number;
  ranged: number;
  magic: number;
}

/** Flat level boosts from potions (e.g. super combat = +5 +15% of level). */
export interface Boosts {
  attack: number;
  strength: number;
  ranged: number;
  magic: number;
}

/** Prayer multipliers, e.g. Piety = 1.20 attack / 1.23 strength. */
export interface Prayers {
  attack: number;
  strength: number;
  ranged: number;
  rangedStrength: number;
  magic: number;
}

/** Attack style bonuses: accurate +3 attack, aggressive +3 strength, controlled +1 both. */
export interface StyleBonus {
  attack: number;
  strength: number;
}

export interface EquipBonuses {
  /** Offensive bonus for the attack style being used (stab/slash/crush/ranged/magic). */
  attack: number;
  /** Strength bonus (melee str, ranged str, or magic damage %). */
  strength: number;
}

export interface LoadoutInput {
  name: string;
  type: AttackType;
  levels: CombatLevels;
  boosts: Boosts;
  prayers: Prayers;
  style: StyleBonus;
  equip: EquipBonuses;
  speed: number;
  defStyle: DefStyle;
  /** Void multipliers, 1 when not wearing void. */
  voidAttack?: number;
  voidStrength?: number;
  /**
   * Gear multipliers applied after the base roll (crystal, salve, slayer helm...).
   * Applied in order with a truncation after each, because OSRS floors every step
   * and collapsing them into one multiply changes results by 1.
   */
  attackFactors?: Factor[];
  damageFactors?: Factor[];
  /**
   * Bypass the strength formula entirely. Magic does not derive its max hit from
   * a strength bonus - it comes from the spell or the powered staff - so the
   * magic path computes its own value and passes it here.
   */
  maxHitOverride?: number;
  ammoName?: string | null;
}

/** An integer multiplier as [numerator, denominator]. */
export type Factor = [num: number, den: number];

const applyFactors = (value: number, factors: Factor[]): number => {
  let v = value;
  for (const [num, den] of factors) v = Math.trunc((v * num) / den);
  return v;
};

/** Effective level: floor(level * prayer) + style + 8, then floor(* void). */
const effectiveLevel = (
  level: number,
  boost: number,
  prayer: number,
  styleBonus: number,
  voidMult: number,
): number => {
  let e = Math.trunc((level + boost) * prayer);
  e += styleBonus + 8;
  return Math.trunc(e * voidMult);
};

export const buildLoadout = (input: LoadoutInput): Loadout => {
  const {
    name, type, levels, boosts, prayers, style, equip, speed, defStyle,
    voidAttack = 1, voidStrength = 1,
    attackFactors = [], damageFactors = [], maxHitOverride, ammoName
  } = input;

  const isRanged = type === 'ranged';
  const atkLevel = isRanged ? levels.ranged : levels.attack;
  const atkBoost = isRanged ? boosts.ranged : boosts.attack;
  const atkPrayer = isRanged ? prayers.ranged : prayers.attack;

  const strLevel = isRanged ? levels.ranged : levels.strength;
  const strBoost = isRanged ? boosts.ranged : boosts.strength;
  const strPrayer = isRanged ? prayers.rangedStrength : prayers.strength;

  const effAtk = effectiveLevel(atkLevel, atkBoost, atkPrayer, style.attack, voidAttack);
  const effStr = effectiveLevel(strLevel, strBoost, strPrayer, style.strength, voidStrength);

  const attackRoll = applyFactors(effAtk * (equip.attack + 64), attackFactors);
  // Magic supplies its own base hit, but multiplicative gear bonuses (bane
  // weapons) still apply on top of it.
  const baseMax = maxHitOverride ?? Math.trunc((effStr * (equip.strength + 64) + 320) / 640);
  const maxHit = applyFactors(baseMax, damageFactors);

  return { name, type, attackRoll, maxHit, speed, defStyle, ammoName };
};

/** Common prayer presets. */
export const PRAYERS: Record<string, Prayers> = {
  none: { attack: 1, strength: 1, ranged: 1, rangedStrength: 1, magic: 1 },
  piety: { attack: 1.2, strength: 1.23, ranged: 1, rangedStrength: 1, magic: 1 },
  chivalry: { attack: 1.15, strength: 1.18, ranged: 1, rangedStrength: 1, magic: 1 },
  rigour: { attack: 1, strength: 1, ranged: 1.2, rangedStrength: 1.23, magic: 1 },
  eagleEye: { attack: 1, strength: 1, ranged: 1.15, rangedStrength: 1.15, magic: 1 },
  augury: { attack: 1, strength: 1, ranged: 1, rangedStrength: 1, magic: 1.25 },
};

/** Attack style presets. */
export const STYLES: Record<string, StyleBonus> = {
  accurate: { attack: 3, strength: 0 },
  aggressive: { attack: 0, strength: 3 },
  controlled: { attack: 1, strength: 1 },
  defensive: { attack: 0, strength: 0 },
  rapid: { attack: 0, strength: 0 },
  longrange: { attack: 0, strength: 0 },
};
