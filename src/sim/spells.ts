/**
 * Magic damage.
 *
 * Magic does not use the melee/ranged strength formula at all: the base hit
 * comes from the spell you cast, or from a powered staff's own level formula,
 * and the magic damage bonus is then applied additively in tenths of a percent.
 */

export interface Spell {
  name: string;
  maxHit: number;
  spellbook: string;
  image: string | null;
}

/**
 * Powered staves ignore the spellbook and scale off Magic level.
 * Each has its own offset, so they are matched by name.
 */
const POWERED_STAVES: [RegExp, (magicLevel: number) => number][] = [
  [/^Tumeken's shadow/i, (l) => Math.trunc(l / 3) + 1],
  [/^(Holy )?Sanguinesti staff/i, (l) => Math.trunc(l / 3)],
  [/^Trident of the Swamp/i, (l) => Math.trunc(l / 3) - 2],
  [/^Trident of the Seas/i, (l) => Math.trunc(l / 3) - 5],
  [/^Accursed sceptre/i, (l) => Math.trunc(l / 3) - 6],
  [/^Eye of Ayak/i, (l) => Math.trunc(l / 3) - 6],
  [/^Thammaron's sceptre/i, (l) => Math.trunc(l / 3) - 8],
  [/^Warped sceptre/i, (l) => Math.trunc((8 * l + 96) / 37)],
  [/^Crystal staff \(basic\)|^Corrupted staff \(basic\)/i, () => 23],
  [/^Crystal staff \(attuned\)|^Corrupted staff \(attuned\)/i, () => 31],
  [/^Crystal staff \(perfected\)|^Corrupted staff \(perfected\)/i, () => 39],
  [/^Starter staff/i, () => 8],
];

/** Base max hit for a powered staff, or null if this weapon is not one. */
export const poweredStaffMaxHit = (
  weaponName: string | null | undefined,
  magicLevel: number,
): number | null => {
  if (!weaponName) return null;
  const hit = POWERED_STAVES.find(([re]) => re.test(weaponName));
  return hit ? Math.max(1, hit[1](magicLevel)) : null;
};

export interface MagicMaxHitInput {
  /** The selected spell, if any. Ignored when a powered staff is equipped. */
  spell: Spell | null;
  weaponName: string | null | undefined;
  magicLevel: number;
  /** Total magic damage bonus in tenths of a percent (Occult +50 = 5%). */
  magicDamageBonus: number;
  /** Slayer helmet's 23/20 multiplier, applied after the additive bonus. */
  blackMask: boolean;
}

export const magicMaxHit = (input: MagicMaxHitInput): number => {
  const { spell, weaponName, magicLevel, magicDamageBonus, blackMask } = input;

  // A powered staff supplies its own damage and overrides the spellbook.
  const staffBase = poweredStaffMaxHit(weaponName, magicLevel);
  const base = staffBase ?? spell?.maxHit ?? 0;
  if (base <= 0) return 0;

  // Magic damage is additive, in tenths of a percent.
  let maxHit = base + Math.trunc((base * magicDamageBonus) / 1000);
  if (blackMask) maxHit = Math.trunc((maxHit * 23) / 20);
  return maxHit;
};

/** True when the weapon casts on its own and a spell choice is irrelevant. */
export const isPoweredStaff = (weaponName: string | null | undefined): boolean =>
  poweredStaffMaxHit(weaponName, 99) !== null;
