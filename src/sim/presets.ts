import type { AttackType } from './types';
import type { Slot } from './gear';

/**
 * Curated meta setups so people can get a meaningful answer in two clicks.
 * Gear values are "Item name" or "Item name|Version" where the wiki data has
 * multiple variants (e.g. charged vs uncharged).
 */
export interface Preset {
  id: string;
  label: string;
  type: AttackType;
  /** Prayer key from PRAYERS. */
  prayer: string;
  /** Name of the attack style to select, from the weapon's own style list. */
  styleName: string;
  /** Spell to autocast, for setups that cast from a spellbook. */
  spell?: string;
  gear: Partial<Record<Slot, string>>;
}

/**
 * Melee BIS by strength bonus. Amulet of rancour (+12 str) supersedes torture
 * (+10) and Avernic treads (pr) (+6) supersede primordial boots (+5).
 */
const MELEE_BIS = {
  head: 'Torva full helm',
  cape: 'Infernal cape',
  neck: 'Amulet of rancour',
  body: 'Torva platebody',
  shield: 'Avernic defender',
  legs: 'Torva platelegs',
  hands: 'Ferocious gloves',
  feet: 'Avernic treads (pr)',
  ring: 'Ultor ring',
};

const MELEE_MID = {
  head: 'Neitiznot faceguard',
  cape: 'Fire cape',
  neck: 'Amulet of fury',
  body: 'Bandos chestplate',
  shield: 'Dragon defender',
  legs: 'Bandos tassets',
  hands: 'Barrows gloves',
  feet: 'Dragon boots',
  ring: 'Berserker ring (i)',
};

/** Necklace of rupture (+8 ranged str) supersedes anguish (+5); treads (pe) beat pegasians. */
const RANGED_BIS = {
  head: 'Masori mask (f)',
  cape: "Blessed Dizana's quiver",
  neck: 'Necklace of rupture',
  body: 'Masori body (f)',
  legs: 'Masori chaps (f)',
  hands: 'Zaryte vambraces',
  feet: 'Avernic treads (pe)',
  ring: 'Venator ring',
};

/** Confliction gauntlets (+7% magic dmg) supersede tormented (+5%); treads (et) beat eternals. */
const MAGE_BIS = {
  head: 'Ancestral hat',
  cape: 'Imbued Zamorak cape',
  neck: 'Occult necklace',
  body: 'Ancestral robe top',
  legs: 'Ancestral robe bottom',
  hands: 'Confliction gauntlets',
  feet: 'Avernic treads (et)',
  ring: 'Magus ring',
};

export const PRESETS: Preset[] = [
  {
    id: 'max_melee_scythe',
    label: 'Max melee - Scythe of Vitur',
    type: 'melee',
    prayer: 'piety',
    styleName: 'Reap',
    // Oathplate's huge slash accuracy beats Torva's raw strength on a slash weapon,
    // but the Torva helm still wins the head slot.
    gear: {
      ...MELEE_BIS,
      shield: undefined,
      head: 'Torva full helm',
      body: 'Oathplate chest',
      legs: 'Oathplate legs',
      weapon: 'Scythe of Vitur|Charged',
    },
  },
  {
    id: 'max_melee_fang',
    label: "Max melee - Osmumten's fang",
    type: 'melee',
    prayer: 'piety',
    styleName: 'Stab',
    gear: { ...MELEE_BIS, weapon: "Osmumten's fang" },
  },
  {
    id: 'mid_melee_whip',
    label: 'Mid melee - Abyssal whip + Bandos',
    type: 'melee',
    prayer: 'piety',
    styleName: 'Lash',
    gear: { ...MELEE_MID, weapon: 'Abyssal whip' },
  },
  {
    id: 'mid_melee_scim',
    label: 'Budget melee - Dragon scimitar',
    type: 'melee',
    prayer: 'chivalry',
    styleName: 'Slash',
    gear: { ...MELEE_MID, weapon: 'Dragon scimitar' },
  },
  {
    id: 'max_ranged_tbow',
    label: 'Max ranged - Twisted bow',
    type: 'ranged',
    prayer: 'rigour',
    styleName: 'Rapid',
    gear: { ...RANGED_BIS, weapon: 'Twisted bow', ammo: 'Dragon arrow' },
  },
  {
    id: 'max_ranged_tbow_void',
    label: 'Max ranged - Twisted bow + elite void',
    type: 'ranged',
    prayer: 'rigour',
    styleName: 'Rapid',
    // Elite void trades the Masori damage bonuses for +10% accuracy and +12.5% damage.
    gear: {
      ...RANGED_BIS,
      head: 'Void ranger helm',
      body: 'Elite void top',
      legs: 'Elite void robe',
      hands: 'Void knight gloves',
      weapon: 'Twisted bow',
      ammo: 'Dragon arrow',
    },
  },
  {
    id: 'max_ranged_bowfa',
    label: 'Max ranged - Bow of Faerdhinen',
    type: 'ranged',
    prayer: 'rigour',
    styleName: 'Rapid',
    gear: {
      ...RANGED_BIS,
      head: 'Crystal helm',
      body: 'Crystal body',
      legs: 'Crystal legs',
      weapon: 'Bow of Faerdhinen|Charged',
    },
  },
  {
    id: 'max_ranged_zcb',
    label: 'Max ranged - Zaryte crossbow',
    type: 'ranged',
    prayer: 'rigour',
    styleName: 'Rapid',
    gear: {
      ...RANGED_BIS,
      shield: 'Twisted buckler',
      weapon: 'Zaryte crossbow',
      ammo: 'Ruby dragon bolts (e)',
    },
  },
  {
    id: 'max_ranged_blowpipe',
    label: 'Max ranged - Toxic blowpipe',
    type: 'ranged',
    prayer: 'rigour',
    styleName: 'Rapid',
    gear: { ...RANGED_BIS, weapon: 'Toxic blowpipe', ammo: 'Dragon dart' },
  },
  {
    id: 'max_magic_shadow',
    label: "Max magic - Tumeken's shadow",
    type: 'magic',
    prayer: 'augury',
    styleName: 'Accurate',
    gear: { ...MAGE_BIS, weapon: "Tumeken's shadow" },
  },
  {
    id: 'max_magic_ancients',
    label: 'Max ancients - Kodai wand + Virtus',
    type: 'magic',
    prayer: 'augury',
    styleName: 'Spell',
    spell: 'Ice Barrage',
    gear: {
      ...MAGE_BIS,
      head: 'Virtus mask',
      body: 'Virtus robe top',
      legs: 'Virtus robe bottom',
      shield: "Elidinis' ward (f)",
      weapon: 'Kodai wand',
    },
  },
  {
    id: 'max_magic_trident',
    label: 'Mid magic - Trident of the Swamp',
    type: 'magic',
    prayer: 'augury',
    styleName: 'Accurate',
    gear: { ...MAGE_BIS, shield: "Elidinis' ward (f)", weapon: 'Trident of the Swamp' },
  },
];

/** Split a preset gear value into name and optional version. */
export const parseGearRef = (ref: string): { name: string; version: string | null } => {
  const [name, version] = ref.split('|');
  return { name, version: version ?? null };
};
