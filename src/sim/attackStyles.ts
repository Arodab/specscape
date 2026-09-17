import type { AttackType, DefStyle } from './types';

/**
 * The attack styles each weapon category actually offers in game.
 *
 * A magic staff has no "Aggressive (+3 str)" option and a bow has no stab
 * style, so the picker has to be driven by the equipped weapon rather than
 * showing one fixed list.
 */

export type Stance =
  | 'accurate' | 'aggressive' | 'controlled' | 'defensive'
  | 'rapid' | 'longrange' | 'autocast';

export interface AttackStyle {
  /** In-game style name, e.g. "Lunge". */
  name: string;
  /** Which monster defence stat this style rolls against. */
  type: DefStyle;
  stance: Stance;
  /** Melee, ranged or magic - decides which levels and bonuses apply. */
  attackType: AttackType;
}

export interface StanceBonus {
  attack: number;
  strength: number;
  /** Rapid fires one tick faster; everything else leaves weapon speed alone. */
  speedDelta: number;
}

export const STANCE_BONUS: Record<Stance, StanceBonus> = {
  accurate: { attack: 3, strength: 0, speedDelta: 0 },
  aggressive: { attack: 0, strength: 3, speedDelta: 0 },
  controlled: { attack: 1, strength: 1, speedDelta: 0 },
  defensive: { attack: 0, strength: 0, speedDelta: 0 },
  rapid: { attack: 0, strength: 0, speedDelta: -1 },
  longrange: { attack: 0, strength: 0, speedDelta: 0 },
  autocast: { attack: 0, strength: 0, speedDelta: 0 },
};

const melee = (name: string, type: DefStyle, stance: Stance): AttackStyle =>
  ({ name, type, stance, attackType: 'melee' });
const ranged = (name: string, type: DefStyle, stance: Stance): AttackStyle =>
  ({ name, type, stance, attackType: 'ranged' });
const magic = (name: string, stance: Stance): AttackStyle =>
  ({ name, type: 'magic', stance, attackType: 'magic' });

/** Ranged weapons roll against different defence stats depending on ammo type. */
const rangedStyles = (defType: DefStyle): AttackStyle[] => [
  ranged('Accurate', defType, 'accurate'),
  ranged('Rapid', defType, 'rapid'),
  ranged('Longrange', defType, 'longrange'),
];

const SPELL_STYLES: AttackStyle[] = [
  magic('Spell', 'autocast'),
  magic('Spell (defensive)', 'defensive'),
];

/** Keyed by the `category` string in the wiki equipment data. */
const BY_CATEGORY: Record<string, AttackStyle[]> = {
  'Stab Sword': [
    melee('Stab', 'stab', 'accurate'),
    melee('Lunge', 'stab', 'aggressive'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Block', 'stab', 'defensive'),
  ],
  'Slash Sword': [
    melee('Chop', 'slash', 'accurate'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Lunge', 'stab', 'controlled'),
    melee('Block', 'slash', 'defensive'),
  ],
  '2h Sword': [
    melee('Chop', 'slash', 'accurate'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Smash', 'crush', 'aggressive'),
    melee('Block', 'slash', 'defensive'),
  ],
  Axe: [
    melee('Chop', 'slash', 'accurate'),
    melee('Hack', 'slash', 'aggressive'),
    melee('Smash', 'crush', 'aggressive'),
    melee('Block', 'slash', 'defensive'),
  ],
  Blunt: [
    melee('Pound', 'crush', 'accurate'),
    melee('Pummel', 'crush', 'aggressive'),
    melee('Block', 'crush', 'defensive'),
  ],
  Bludgeon: [
    melee('Pound', 'crush', 'accurate'),
    melee('Pummel', 'crush', 'aggressive'),
    melee('Smash', 'crush', 'aggressive'),
  ],
  Whip: [
    melee('Flick', 'slash', 'accurate'),
    melee('Lash', 'slash', 'controlled'),
    melee('Deflect', 'slash', 'defensive'),
  ],
  Claw: [
    melee('Chop', 'slash', 'accurate'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Lunge', 'stab', 'controlled'),
    melee('Block', 'slash', 'defensive'),
  ],
  Scythe: [
    melee('Reap', 'slash', 'accurate'),
    melee('Chop', 'slash', 'aggressive'),
    melee('Jab', 'crush', 'controlled'),
    melee('Block', 'slash', 'defensive'),
  ],
  Spear: [
    melee('Lunge', 'stab', 'controlled'),
    melee('Swipe', 'slash', 'controlled'),
    melee('Pound', 'crush', 'controlled'),
    melee('Block', 'stab', 'defensive'),
  ],
  Banner: [
    melee('Lunge', 'stab', 'controlled'),
    melee('Swipe', 'slash', 'controlled'),
    melee('Pound', 'crush', 'controlled'),
    melee('Block', 'stab', 'defensive'),
  ],
  Partisan: [
    melee('Stab', 'stab', 'accurate'),
    melee('Lunge', 'stab', 'aggressive'),
    melee('Pound', 'crush', 'aggressive'),
    melee('Block', 'stab', 'defensive'),
  ],
  Spiked: [
    melee('Pound', 'crush', 'accurate'),
    melee('Pummel', 'crush', 'aggressive'),
    melee('Spike', 'stab', 'controlled'),
    melee('Block', 'crush', 'defensive'),
  ],
  Polearm: [
    melee('Jab', 'stab', 'controlled'),
    melee('Swipe', 'slash', 'aggressive'),
    melee('Fend', 'stab', 'defensive'),
  ],
  Pickaxe: [
    melee('Spike', 'stab', 'accurate'),
    melee('Impale', 'stab', 'aggressive'),
    melee('Smash', 'crush', 'aggressive'),
    melee('Block', 'stab', 'defensive'),
  ],
  Bulwark: [
    melee('Pummel', 'crush', 'accurate'),
    melee('Block', 'crush', 'defensive'),
  ],
  Unarmed: [
    melee('Punch', 'crush', 'accurate'),
    melee('Kick', 'crush', 'aggressive'),
    melee('Block', 'crush', 'defensive'),
  ],
  'Multi-Melee': [
    melee('Poke', 'stab', 'accurate'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Pound', 'crush', 'aggressive'),
    melee('Block', 'stab', 'defensive'),
  ],
  Flail: [
    melee('Chop', 'slash', 'accurate'),
    melee('Slash', 'slash', 'aggressive'),
    melee('Block', 'slash', 'defensive'),
  ],

  // Staves can bash, but anyone comparing specs is casting.
  Staff: [
    ...SPELL_STYLES,
    melee('Bash', 'crush', 'accurate'),
    melee('Pound', 'crush', 'aggressive'),
    melee('Focus', 'crush', 'defensive'),
  ],
  Polestaff: [
    ...SPELL_STYLES,
    melee('Bash', 'crush', 'accurate'),
    melee('Pound', 'crush', 'aggressive'),
    melee('Block', 'crush', 'defensive'),
  ],
  'Bladed Staff': [
    ...SPELL_STYLES,
    melee('Jab', 'stab', 'accurate'),
    melee('Swipe', 'slash', 'aggressive'),
    melee('Fend', 'crush', 'defensive'),
  ],
  'Powered Staff': [
    magic('Accurate', 'accurate'),
    magic('Longrange', 'longrange'),
  ],
  'Powered Wand': [
    magic('Accurate', 'accurate'),
    magic('Longrange', 'longrange'),
  ],

  Bow: rangedStyles('standard'),
  Crossbow: rangedStyles('heavy'),
  Thrown: rangedStyles('light'),
  Chinchompas: [
    ranged('Short fuse', 'heavy', 'accurate'),
    ranged('Medium fuse', 'heavy', 'rapid'),
    ranged('Long fuse', 'heavy', 'longrange'),
  ],
  Salamander: [
    melee('Scorch', 'crush', 'aggressive'),
    ranged('Flare', 'standard', 'accurate'),
    magic('Blaze', 'defensive'),
  ],
};

const DEFAULT_STYLES = BY_CATEGORY.Unarmed;

export const stylesForCategory = (category: string | null | undefined): AttackStyle[] => {
  if (!category) return DEFAULT_STYLES;
  // The data has one stray lowercase "blunt".
  const key = Object.keys(BY_CATEGORY).find((k) => k.toLowerCase() === category.toLowerCase());
  return key ? BY_CATEGORY[key] : DEFAULT_STYLES;
};

/** The style a weapon defaults to when equipped - the first offensive one. */
export const defaultStyleIndex = (styles: AttackStyle[]): number => {
  const i = styles.findIndex((s) => s.stance !== 'defensive');
  return i === -1 ? 0 : i;
};
