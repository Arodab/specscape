import type { Factor } from './loadout';

/**
 * Bane weapons: gear that only does anything against one kind of monster.
 *
 * These are worth surfacing because they are easy to forget and the swing is
 * large - Arclight is +70% accuracy *and* damage against demons, which beats
 * almost any generic upgrade. The picker pins them to the top when the selected
 * target qualifies, and the multipliers below are applied to the simulation so
 * the numbers match what the weapon actually does.
 */

export interface BaneWeapon {
  /** Matches the equipped weapon's name. */
  match: RegExp;
  /** Monster attributes this weapon is a bane for. */
  attributes: string[];
  accuracy?: Factor;
  damage?: Factor;
  /** Shown as a badge in the item picker. */
  label: string;
  /**
   * Entries that exist only so the picker can badge and pin the item, with no
   * multipliers of their own. The salve amulet is the case: it is a neck item,
   * `baneFor` only ever inspects the weapon slot, and its real bonuses come from
   * `detectSalve` in modifiers.ts. Giving it factors here would be dead config.
   */
  displayOnly?: boolean;
}

/** The data splits vampyres into tiers, but the bane gear does not care which. */
const VAMPYRE = ['vampyre1', 'vampyre2', 'vampyre3'];

export const BANE_WEAPONS: BaneWeapon[] = [
  // --- demonbane ---
  {
    match: /^(Arclight|Emberlight)$/i,
    attributes: ['demon'],
    accuracy: [17, 10],
    damage: [17, 10],
    label: 'demonbane +70%',
  },
  {
    match: /^(Silverlight|Darklight|Silverlight \(dyed\))$/i,
    attributes: ['demon'],
    accuracy: [16, 10],
    damage: [16, 10],
    label: 'demonbane +60%',
  },
  {
    match: /^(Burning claws|Bone claws)$/i,
    attributes: ['demon'],
    accuracy: [21, 20],
    damage: [21, 20],
    label: 'demonbane +5%',
  },
  {
    match: /^Scorching bow$/i,
    attributes: ['demon'],
    accuracy: [13, 10],
    damage: [13, 10],
    label: 'demonbane +30%',
  },

  // --- dragonbane ---
  {
    match: /^Dragon hunter crossbow$/i,
    attributes: ['dragon'],
    accuracy: [13, 10],
    damage: [5, 4],
    label: 'dragonbane +30% acc / +25% dmg',
  },
  {
    match: /^Dragon hunter lance$/i,
    attributes: ['dragon'],
    accuracy: [6, 5],
    damage: [6, 5],
    label: 'dragonbane +20%',
  },
  {
    match: /^Dragon hunter wand$/i,
    attributes: ['dragon'],
    accuracy: [7, 4],
    damage: [7, 5],
    label: 'dragonbane +75% acc / +40% dmg',
  },

  // --- kalphitebane ---
  {
    match: /^Keris partisan of breaching$/i,
    attributes: ['kalphite'],
    accuracy: [133, 100],
    damage: [133, 100],
    label: 'kalphitebane +33%',
  },
  {
    match: /^Keris partisan of amascut$/i,
    attributes: ['kalphite'],
    damage: [115, 100],
    label: 'kalphitebane +15%',
  },
  {
    match: /^(Keris|Keris partisan|Keris partisan of corruption)$/i,
    attributes: ['kalphite'],
    damage: [133, 100],
    label: 'kalphitebane +33%',
  },

  // --- golembane ---
  {
    match: /^Barronite mace$/i,
    attributes: ['golem'],
    damage: [23, 20],
    label: 'golembane +15%',
  },
  {
    match: /^Granite hammer$/i,
    attributes: ['golem'],
    damage: [13, 10],
    label: 'golembane +30%',
  },

  // --- leafy ---
  {
    match: /^Leaf-bladed battleaxe$/i,
    attributes: ['leafy'],
    damage: [47, 40],
    label: 'leafy +17.5%',
  },

  // --- vampyrebane ---
  {
    match: /^(Blisterwood flail|Blisterwood sickle)$/i,
    attributes: VAMPYRE,
    accuracy: [105, 100],
    label: 'vampyrebane +5%',
  },
  {
    match: /^(Hallowed flail|Sunspear)$/i,
    attributes: VAMPYRE,
    accuracy: [125, 100],
    label: 'vampyrebane +25%',
  },

  // --- undeadbane ---
  {
    match: /^Salve amulet/i,
    attributes: ['undead'],
    label: 'undeadbane',
    displayOnly: true,
  },
];

/** The bane entry for a weapon against a target, if it applies. */
export const baneFor = (
  weaponName: string | null | undefined,
  monsterAttributes: string[] | null | undefined,
  monsterName?: string,
): BaneWeapon | null => {
  if (!weaponName || !monsterAttributes?.length) return null;
  const bane = BANE_WEAPONS.find(
    (b) => b.match.test(weaponName) && b.attributes.some((a) => monsterAttributes.includes(a)),
  ) ?? null;
  
  if (bane && bane.attributes.includes('demon') && monsterName === 'Duke Sucellus') {
    return null;
  }
  
  return bane;
};

/**
 * Is this weapon a bane weapon for the target at all? Used by the picker to
 * float relevant weapons to the top, regardless of whether it is equipped.
 */
export const isBaneWeaponFor = (
  weaponName: string,
  monsterAttributes: string[] | null | undefined,
): BaneWeapon | null => baneFor(weaponName, monsterAttributes);

/** Every bane weapon that would work against this target, for the UI hint. */
export const baneWeaponsFor = (monsterAttributes: string[] | null | undefined): BaneWeapon[] => {
  if (!monsterAttributes?.length) return [];
  return BANE_WEAPONS.filter((b) => b.attributes.some((a) => monsterAttributes.includes(a)));
};
