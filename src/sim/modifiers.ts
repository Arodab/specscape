import type { Factor } from './loadout';
import type { Equip, GearSet } from './gear';
import { baneFor } from './bane';
import type { AttackType, Monster } from './types';

/**
 * Situational gear multipliers: salve, slayer helmet, void, crystal armour.
 *
 * These are all detected from what is actually equipped rather than chosen from
 * dropdowns - if the salve is on your neck it applies, and if it isn't, it
 * doesn't. The only thing left to say by hand is whether the target is on task,
 * because that is the one fact the gear cannot tell us.
 */

export interface Buffs {
  /**
   * Force off-task even while wearing a slayer helmet. On task is the default
   * because that is why you would be wearing one.
   */
  offTask: boolean;
}

export const DEFAULT_BUFFS: Buffs = { offTask: false };

// ---------------------------------------------------------------------------
// gear detection
// ---------------------------------------------------------------------------

const nameOf = (item: Equip | null | undefined): string => item?.name ?? '';
const isOneOf = (item: Equip | null | undefined, names: string[]): boolean =>
  names.includes(nameOf(item));

const BLACK_MASKS = [
  'Black mask', 'Black mask (i)',
  'Slayer helmet', 'Slayer helmet (i)',
  'Oathplate slayer helmet', 'Oathplate slayer helmet (i)',
  "V's helm",
];

const VOID_TOPS = ['Void knight top', 'Void knight top (or)', 'Elite void top', 'Elite void top (or)'];
const VOID_ROBES = ['Void knight robe', 'Void knight robe (or)', 'Elite void robe', 'Elite void robe (or)'];
const ELITE_TOPS = ['Elite void top', 'Elite void top (or)'];
const ELITE_ROBES = ['Elite void robe', 'Elite void robe (or)'];
const VOID_HELMS: Record<AttackType, string[]> = {
  melee: ['Void melee helm', 'Void melee helm (or)'],
  ranged: ['Void ranger helm', 'Void ranger helm (or)'],
  magic: ['Void mage helm', 'Void mage helm (or)'],
};

/**
 * Every item name the modifier logic keys on that must actually exist in the
 * shipped data, checked by `data.test.ts`.
 *
 * The detection lists above deliberately keep the "(or)" ornament variants so
 * detection still works if the data build ever stops collapsing them, but those
 * are cosmetic duplicates that the build strips today - so they are filtered out
 * here rather than asserted as present.
 */
export const MODIFIER_ITEM_NAMES: string[] = ([
  ...BLACK_MASKS,
  ...VOID_TOPS,
  ...VOID_ROBES,
  ...VOID_HELMS.melee,
  ...VOID_HELMS.ranged,
  ...VOID_HELMS.magic,
  'Void knight gloves',
  'Crystal helm', 'Crystal body', 'Crystal legs',
  'Salve amulet', 'Salve amulet (e)', 'Salve amulet(i)', 'Salve amulet(ei)',
  'Lightbearer',
] as string[]).filter((n) => !n.endsWith(' (or)'));

export type SalveTier = 'none' | 'salve' | 'salve_e';

/** Salve amulet tier from whatever is in the neck slot. */
export const detectSalve = (gear: GearSet): SalveTier => {
  const name = nameOf(gear.neck);
  if (!/^Salve amulet/i.test(name)) return 'none';
  // (e) and (ei) are the enchanted 20% versions; plain and (i) are 16.7%.
  return /\((e|ei)\)/i.test(name) ? 'salve_e' : 'salve';
};

export const detectBlackMask = (gear: GearSet): boolean => isOneOf(gear.head, BLACK_MASKS);

export interface VoidState {
  /** The attack type the equipped void set boosts, if any. */
  type: AttackType | null;
  elite: boolean;
}

export const detectVoid = (gear: GearSet): VoidState => {
  const robes = isOneOf(gear.body, VOID_TOPS)
    && isOneOf(gear.legs, VOID_ROBES)
    && nameOf(gear.hands) === 'Void knight gloves';
  if (!robes) return { type: null, elite: false };

  const elite = isOneOf(gear.body, ELITE_TOPS) && isOneOf(gear.legs, ELITE_ROBES);
  const type = (['melee', 'ranged', 'magic'] as const)
    .find((t) => isOneOf(gear.head, VOID_HELMS[t])) ?? null;
  return { type, elite };
};

const CRYSTAL_BOWS = [/^Bow of Faerdhinen/i, /^Crystal bow/i];

/** Crystal armour only does anything alongside a crystal bow. */
const crystalPieces = (gear: GearSet): number => {
  const weapon = gear.weapon;
  if (!weapon || !CRYSTAL_BOWS.some((re) => re.test(weapon.name))) return 0;
  return (nameOf(gear.head) === 'Crystal helm' ? 1 : 0)
    + (nameOf(gear.legs) === 'Crystal legs' ? 2 : 0)
    + (nameOf(gear.body) === 'Crystal body' ? 3 : 0);
};

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export interface ResolvedModifiers {
  attackFactors: Factor[];
  damageFactors: Factor[];
  voidAttack: number;
  voidStrength: number;
  /**
   * Magic damage is additive in tenths of a percent rather than a multiplier,
   * so salve and the slayer helmet feed this instead of `damageFactors`.
   */
  magicDamageBonus: number;
  /** Slayer helmet's magic multiplier, applied after the additive bonus. */
  magicBlackMask: boolean;
  /** Human-readable list of what actually applied, for the UI. */
  applied: string[];
}

export const resolveModifiers = (
  buffs: Buffs,
  gear: GearSet,
  monster: Monster | null,
  type: AttackType,
): ResolvedModifiers => {
  const attackFactors: Factor[] = [];
  const damageFactors: Factor[] = [];
  const applied: string[] = [];
  let magicDamageBonus = 0;
  let magicBlackMask = false;

  // --- crystal armour, applied before the target-specific bonuses ---
  const pieces = crystalPieces(gear);
  if (pieces > 0) {
    attackFactors.push([20 + pieces, 20]);
    damageFactors.push([40 + pieces, 40]);
    applied.push(`Crystal armour (${pieces}/6)`);
  }

  // --- salve and slayer helmet: mutually exclusive, salve wins ---
  const salve = detectSalve(gear);
  const hasMask = detectBlackMask(gear);
  const onTask = !buffs.offTask;

  const undead = !!monster?.attributes.includes('undead');
  const salveApplies = salve !== 'none' && undead;
  const maskApplies = hasMask && onTask && !!monster?.isSlayerMonster;

  if (salveApplies) {
    if (type === 'magic') {
      magicDamageBonus += salve === 'salve_e' ? 200 : 150;
      attackFactors.push(salve === 'salve_e' ? [6, 5] : [23, 20]);
    } else {
      const f: Factor = salve === 'salve_e' ? [6, 5] : [7, 6];
      attackFactors.push(f);
      damageFactors.push(f);
    }
    applied.push(salve === 'salve_e' ? 'Salve (e/ei) +20%' : 'Salve +16.7%');
  } else if (maskApplies) {
    if (type === 'magic') {
      magicBlackMask = true;
      attackFactors.push([23, 20]);
    } else {
      attackFactors.push([7, 6]);
      damageFactors.push([7, 6]);
    }
    applied.push('Slayer helm +16.7%');
  } else {
    if (salve !== 'none' && !undead) applied.push('Salve inactive (target not undead)');
    if (hasMask && !onTask) applied.push('Slayer helm inactive (off task)');
    else if (hasMask && !monster?.isSlayerMonster) applied.push('Slayer helm inactive (not a slayer monster)');
  }

  // --- bane weapons: only do anything against their own monster type ---
  const bane = baneFor(gear.weapon?.name, monster?.attributes);
  if (bane) {
    if (bane.accuracy) attackFactors.push(bane.accuracy);
    if (bane.damage) damageFactors.push(bane.damage);
    applied.push(bane.label);
  }

  // --- void: applied to the effective level, not the roll ---
  const voidState = detectVoid(gear);
  let voidAttack = 1;
  let voidStrength = 1;
  if (voidState.type === type) {
    if (type === 'magic') {
      voidAttack = 29 / 20;
      voidStrength = 1;
      applied.push('Magic void +45% accuracy');
    } else {
      voidAttack = 11 / 10;
      // Elite void gives more damage on ranged; melee elite is the same as regular.
      voidStrength = voidState.elite && type === 'ranged' ? 9 / 8 : 11 / 10;
      applied.push(
        voidState.elite && type === 'ranged' ? 'Elite void +10% acc / +12.5% dmg' : 'Void +10%',
      );
    }
  } else if (voidState.type) {
    applied.push(`Void inactive (${voidState.type} set, ${type} attack)`);
  }

  return {
    attackFactors, damageFactors, voidAttack, voidStrength,
    magicDamageBonus, magicBlackMask, applied,
  };
};
