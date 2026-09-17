import type { AttackType, DefStyle } from './types';

/** Equipment record as emitted by scripts/build-data.mjs. */
export interface Equip {
  id: number;
  name: string;
  slot: Slot;
  version: string | null;
  speed: number | null;
  category: string | null;
  twoHanded: boolean;
  /** Wiki image filename, e.g. "Ghrazi rapier.png". */
  image: string | null;
  o: {
    stab: number; slash: number; crush: number; magic: number; ranged: number;
    str: number; ranged_str: number; magic_str: number;
  };
}

export const SLOTS = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'body',
  'shield', 'legs', 'hands', 'feet', 'ring',
] as const;
export type Slot = (typeof SLOTS)[number];

export type GearSet = Partial<Record<Slot, Equip | null>>;

export interface Bonuses {
  stab: number; slash: number; crush: number; magic: number; ranged: number;
  str: number; ranged_str: number; magic_str: number;
}

const ZERO: Bonuses = {
  stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0, str: 0, ranged_str: 0, magic_str: 0,
};

/** Sum offensive bonuses across a gear set, optionally skipping the weapon slot. */
export const sumBonuses = (set: GearSet, opts: { excludeWeapon?: boolean } = {}): Bonuses => {
  const total = { ...ZERO };
  for (const slot of SLOTS) {
    if (opts.excludeWeapon && slot === 'weapon') continue;
    const piece = set[slot];
    if (!piece) continue;
    for (const key of Object.keys(total) as (keyof Bonuses)[]) {
      total[key] += piece.o[key] ?? 0;
    }
  }
  return total;
};

/** Melee attack styles a weapon category can use, and the matching defence stat. */
const MELEE_SLASH = ['Slash Sword', '2h Sword', 'Whip', 'Claw', 'Axe', 'Banner'];
const MELEE_STAB = ['Stab Sword', 'Spear', 'Spiked', 'Polearm', 'Pickaxe'];
const MELEE_CRUSH = ['Blunt', 'Bludgeon', 'Bulwark', 'Unarmed'];
const RANGED = ['Bow', 'Crossbow', 'Thrown', 'Chinchompas', 'Salamander'];
const MAGIC = ['Staff', 'Powered Staff', 'Bladed Staff', 'Polestaff'];

export interface WeaponProfile {
  type: AttackType;
  /** Defence stat this weapon rolls against by default. */
  defStyle: DefStyle;
  speed: number;
}

export const weaponProfile = (weapon: Equip | null | undefined): WeaponProfile => {
  if (!weapon) return { type: 'melee', defStyle: 'crush', speed: 4 };
  const cat = weapon.category ?? '';
  const speed = weapon.speed ?? 4;

  if (RANGED.includes(cat)) return { type: 'ranged', defStyle: 'standard', speed };
  if (MAGIC.includes(cat)) return { type: 'magic', defStyle: 'magic', speed };
  if (MELEE_STAB.includes(cat)) return { type: 'melee', defStyle: 'stab', speed };
  if (MELEE_CRUSH.includes(cat)) return { type: 'melee', defStyle: 'crush', speed };
  if (MELEE_SLASH.includes(cat)) return { type: 'melee', defStyle: 'slash', speed };

  // Unknown category: fall back to whichever melee bonus is highest.
  const best = (['stab', 'slash', 'crush'] as const)
    .reduce((a, b) => (weapon.o[a] >= weapon.o[b] ? a : b));
  return { type: 'melee', defStyle: best, speed };
};

/** The offensive bonus that matters for a given defence style. */
export const attackBonusFor = (b: Bonuses, style: DefStyle): number => {
  switch (style) {
    case 'stab': return b.stab;
    case 'slash': return b.slash;
    case 'crush': return b.crush;
    case 'magic': return b.magic;
    default: return b.ranged;
  }
};

/** Full URL for an item's inventory icon on the OSRS Wiki. */
export const itemImageUrl = (item: Equip): string | null =>
  item.image ? `https://oldschool.runescape.wiki/images/${encodeURIComponent(item.image.replace(/ /g, '_'))}` : null;

/** The strength bonus that matters for a given attack type. */
export const strengthBonusFor = (b: Bonuses, type: AttackType): number => {
  if (type === 'ranged') return b.ranged_str;
  if (type === 'magic') return b.magic_str;
  return b.str;
};

/**
 * Many items appear several times with cosmetic or state variants (Broken,
 * Locked, Uncharged...). When a caller does not name a version, pick the one a
 * player would actually be using.
 */
const VERSION_RANK = [
  /^$/, /^normal$/i, /^restored$/i, /^charged$/i, /^active$/i, /^undamaged$/i,
];
const VERSION_PENALTY = /broken|locked|uncharged|inactive|deadman|partially/i;

export const pickVariant = (matches: Equip[]): Equip | undefined => {
  if (matches.length <= 1) return matches[0];
  const score = (e: Equip): number => {
    const v = e.version ?? '';
    if (VERSION_PENALTY.test(v)) return 100;
    const idx = VERSION_RANK.findIndex((re) => re.test(v));
    return idx === -1 ? 50 : idx;
  };
  return [...matches].sort((a, b) => score(a) - score(b))[0];
};

/**
 * Which ammo a weapon can actually use.
 *
 * Bows take arrows, crossbows take bolts, ballistae take javelins and the
 * blowpipe takes darts. Thrown weapons and chinchompas are their own ammo, so
 * they get an empty list rather than the full catalogue.
 */
export type AmmoKind = 'arrow' | 'bolt' | 'javelin' | 'dart' | 'brutal' | 'tar' | null;

export const ammoKindFor = (weapon: Equip | null | undefined): AmmoKind => {
  if (!weapon) return null;
  const { name, category } = weapon;

  if (/blowpipe/i.test(name)) return 'dart';
  if (/ballista/i.test(name)) return 'javelin';
  if (/^Ogre bow|^Comp ogre bow/i.test(name)) return 'brutal';
  if (category === 'Crossbow') return 'bolt';
  if (category === 'Bow') return 'arrow';
  if (category === 'Salamander') return 'tar';
  // Thrown weapons and chinchompas carry their own ammo.
  return null;
};

const AMMO_PATTERNS: Record<Exclude<AmmoKind, null>, RegExp> = {
  arrow: /arrow/i,
  bolt: /bolt/i,
  javelin: /javelin/i,
  dart: /dart/i,
  brutal: /brutal/i,
  tar: /tar$/i,
};

/** Ammo from `pool` that the weapon can equip. */
export const ammoFor = (weapon: Equip | null | undefined, pool: Equip[]): Equip[] => {
  const kind = ammoKindFor(weapon);
  if (!kind) return [];
  const re = AMMO_PATTERNS[kind];
  return pool.filter((e) => re.test(e.name));
};

/** The ammo a weapon should default to when you equip it. */
export const DEFAULT_AMMO: Partial<Record<Exclude<AmmoKind, null>, string>> = {
  arrow: 'Dragon arrow',
  bolt: 'Ruby dragon bolts (e)',
  javelin: 'Dragon javelin',
  dart: 'Dragon dart',
};
