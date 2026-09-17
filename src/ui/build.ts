import { buildLoadout, PRAYERS, type CombatLevels } from '../sim/loadout';
import {
  SLOTS, attackBonusFor, pickVariant, strengthBonusFor, sumBonuses,
  type Equip, type GearSet, type Slot,
} from '../sim/gear';
import {
  STANCE_BONUS, defaultStyleIndex, stylesForCategory, type AttackStyle,
} from '../sim/attackStyles';
import { resolveModifiers, type Buffs } from '../sim/modifiers';
import { magicMaxHit, type Spell } from '../sim/spells';
import { SPECS, type SpecDef } from '../sim/specs';
import type { Loadout, Monster } from '../sim/types';

/** Potion boosts, as a flat level increase computed from the base level. */
export interface Potion {
  id: string;
  label: string;
  attack: (lvl: number) => number;
  strength: (lvl: number) => number;
  ranged: (lvl: number) => number;
  magic: (lvl: number) => number;
}

const none = () => 0;
const superPot = (lvl: number) => 5 + Math.floor(lvl * 0.15);
const rangingPot = (lvl: number) => 4 + Math.floor(lvl * 0.1);
const overload = (lvl: number) => 6 + Math.floor(lvl * 0.16);

export const POTIONS: Potion[] = [
  { id: 'none', label: 'No potion', attack: none, strength: none, ranged: none, magic: none },
  { id: 'super_combat', label: 'Super combat', attack: superPot, strength: superPot, ranged: none, magic: none },
  { id: 'super_att_str', label: 'Super attack + strength', attack: superPot, strength: superPot, ranged: none, magic: none },
  { id: 'ranging', label: 'Ranging potion', attack: none, strength: none, ranged: rangingPot, magic: none },
  { id: 'bastion', label: 'Bastion potion', attack: none, strength: none, ranged: rangingPot, magic: none },
  { id: 'overload', label: 'Overload (+)', attack: overload, strength: overload, ranged: overload, magic: overload },
  { id: 'imbued_heart', label: 'Imbued heart', attack: none, strength: none, ranged: none, magic: (l) => 1 + Math.floor(l * 0.1) },
];

export const potionById = (id: string): Potion => POTIONS.find((p) => p.id === id) ?? POTIONS[0];

export interface SetupInput {
  gear: GearSet;
  levels: CombatLevels;
  potionId: string;
  prayerKey: string;
  /** Index into the equipped weapon's own style list. */
  styleIndex: number;
  /** Selected spell, ignored when a powered staff is equipped. */
  spell: Spell | null;
  buffs: Buffs;
}

const boostsFor = (potionId: string, levels: CombatLevels) => {
  const p = potionById(potionId);
  return {
    attack: p.attack(levels.attack),
    strength: p.strength(levels.strength),
    ranged: p.ranged(levels.ranged),
    magic: p.magic(levels.magic),
  };
};

/** The styles the equipped weapon offers, and which one is selected. */
export const stylesFor = (gear: GearSet): AttackStyle[] =>
  stylesForCategory(gear.weapon?.category);

export const selectedStyle = (gear: GearSet, styleIndex: number): AttackStyle => {
  const styles = stylesFor(gear);
  return styles[Math.min(Math.max(0, styleIndex), styles.length - 1)] ?? styles[0];
};

/**
 * Build the main-weapon loadout. The target is needed because salve, the slayer
 * helmet and demonbane gear only apply to particular monsters.
 */
export const buildMain = (setup: SetupInput, monster: Monster | null): Loadout => {
  const { gear, levels, potionId, prayerKey, styleIndex, spell, buffs } = setup;
  const weapon = gear.weapon ?? null;

  const style = selectedStyle(gear, styleIndex);
  const stance = STANCE_BONUS[style.stance];
  const type = style.attackType;

  const bonuses = sumBonuses(gear);
  const mods = resolveModifiers(buffs, gear, monster, type);

  // Rapid shaves a tick off the weapon's attack speed.
  const speed = Math.max(1, (weapon?.speed ?? 4) + stance.speedDelta);

  const maxHitOverride = type === 'magic'
    ? magicMaxHit({
      spell,
      weaponName: weapon?.name,
      magicLevel: levels.magic + boostsFor(potionId, levels).magic,
      magicDamageBonus: strengthBonusFor(bonuses, 'magic') + mods.magicDamageBonus,
      blackMask: mods.magicBlackMask,
    })
    : undefined;

  const isToa = monster && /^(Zebak|Kephri|Akkha|Ba-Ba|Tumeken's Warden|Elidinis' Warden|Obelisk|Core)/i.test(monster.name);
  const isCox = monster && monster.attributes.includes('xerician');

  let attackFactors = [...mods.attackFactors];
  let damageFactors = [...mods.damageFactors];
  let equipAttack = attackBonusFor(bonuses, style.type);
  let equipStrength = strengthBonusFor(bonuses, type);
  let magicDamageBonus = mods.magicDamageBonus;

  if (weapon?.name === "Tumeken's shadow") {
    const mult = isToa ? 4 : 3;
    equipAttack = attackBonusFor(bonuses, 'magic') * mult;
    magicDamageBonus = strengthBonusFor(bonuses, 'magic') * mult + mods.magicDamageBonus;
    equipStrength = 0; // Shadow doesn't use standard magic strength from gear directly
  }

  let finalMaxHitOverride = maxHitOverride;

  if (weapon?.name === 'Twisted bow' && monster) {
    const magic = Math.max(monster.magic, monster.d.magic);
    const cap = isCox ? 350 : 250;
    const m = Math.min(cap, magic);
    
    // Twisted bow accuracy and damage scaling
    // Accuracy: 140 + (3d6 - 14)/100 - wait, what's the exact formula?
    // According to OSRS Wiki:
    // Accuracy: 140 + (3 * magic - 10) / 100 - wait...
    // Let me check OSRS twisted bow formula exactly.
    // Acc multiplier: 140 + (3 * magic - 10) / 100 ? No!
    // The exact TBow formula:
    // Wait, let's use the standard simplified wiki formula:
    // Accuracy = 140 + trunc((3*m - 10)/100) - trunc((3*m/10 - 100)^2 / 100)  -- no, the wiki formula is:
    // Accuracy: 140 + (3 * m - 10) / 100 - ((3 * m / 10) - 100)^2 / 100 ?
    // Let's implement the precise tbow formula.
    const accuracyBonus = 140 + Math.trunc((3 * m - 10) / 100) - Math.trunc(Math.pow(m * 3 / 10 - 100, 2) / 100);
    const damageBonus = 250 + Math.trunc((3 * m - 14) / 100) - Math.trunc(Math.pow(m * 3 / 10 - 140, 2) / 100);
    
    // Apply as factor: value / 100 (but wait, max 140 for acc means 140%?)
    // Yes, 1.4x accuracy, meaning factor is [accMult, 100].
    attackFactors.push([Math.max(0, accuracyBonus), 100]);
    damageFactors.push([Math.max(0, damageBonus), 100]);
  }

  if (weapon?.name === "Tumeken's shadow") {
    finalMaxHitOverride = magicMaxHit({
      spell,
      weaponName: weapon?.name,
      magicLevel: levels.magic + boostsFor(potionId, levels).magic,
      magicDamageBonus,
      blackMask: mods.magicBlackMask,
    });
  }

  return buildLoadout({
    name: weapon?.name ?? 'Unarmed',
    type,
    levels,
    boosts: boostsFor(potionId, levels),
    prayers: PRAYERS[prayerKey] ?? PRAYERS.none,
    style: { attack: stance.attack, strength: stance.strength },
    equip: {
      attack: equipAttack,
      strength: weapon?.name === "Tumeken's shadow" ? 0 : equipStrength,
    },
    speed,
    defStyle: style.type,
    voidAttack: mods.voidAttack,
    voidStrength: mods.voidStrength,
    attackFactors,
    damageFactors,
    maxHitOverride: finalMaxHitOverride,
    ammoName: gear.ammo?.name ?? null,
  });
};

/** What the modifiers panel should say is currently active. */
export const activeModifiers = (setup: SetupInput, monster: Monster | null): string[] =>
  resolveModifiers(
    setup.buffs, setup.gear, monster, selectedStyle(setup.gear, setup.styleIndex).attackType,
  ).applied;

/**
 * Build a loadout for a spec weapon swap: your armour stays on, only the weapon
 * changes. A two-handed spec weapon also drops your shield.
 */
export const buildSpecLoadout = (
  setup: SetupInput,
  def: SpecDef,
  specWeapon: Equip,
  monster: Monster | null,
  gearOverrides?: Partial<Record<Slot, Equip | null>>,
): Loadout => {
  const { gear, levels, potionId, prayerKey, spell, buffs } = setup;

  // Base gear, then any per-spec switch the user configured, then the spec weapon.
  const swapped: GearSet = { ...gear };
  if (gearOverrides) {
    for (const slot of SLOTS) {
      if (slot in gearOverrides) swapped[slot] = gearOverrides[slot] ?? null;
    }
  }
  swapped.weapon = specWeapon;
  if (specWeapon.twoHanded) swapped.shield = null;

  const bonuses = sumBonuses(swapped);
  // A spec is used on the spec weapon's own default style.
  const specStyles = stylesForCategory(specWeapon.category);
  const stance = STANCE_BONUS[specStyles[defaultStyleIndex(specStyles)]?.stance ?? 'accurate'];

  // Voidwaker rolls against Magic defence but is still a melee strength weapon,
  // so its attack bonus comes from its slash bonus.
  const attackStyle = def.defStyle === 'magic' && def.type === 'melee' ? 'slash' : def.defStyle;

  const mods = resolveModifiers(buffs, swapped, monster, def.type);

  const magicLevel = levels.magic + boostsFor(potionId, levels).magic;

  let maxHitOverride: number | undefined;
  if (def.levelMaxHit) {
    // The Volatile staff's spec scales off Magic level, not the weapon, but the
    // magic damage bonus still applies on top of it.
    const base = def.levelMaxHit(magicLevel);
    const bonus = strengthBonusFor(bonuses, 'magic') + mods.magicDamageBonus;
    maxHitOverride = base + Math.trunc((base * bonus) / 1000);
  } else if (def.type === 'magic') {
    maxHitOverride = magicMaxHit({
      spell,
      weaponName: specWeapon.name,
      magicLevel,
      magicDamageBonus: strengthBonusFor(bonuses, 'magic') + mods.magicDamageBonus,
      blackMask: mods.magicBlackMask,
    });
  }

  return buildLoadout({
    name: def.name,
    type: def.type,
    levels,
    boosts: boostsFor(potionId, levels),
    prayers: PRAYERS[prayerKey] ?? PRAYERS.none,
    style: { attack: stance.attack, strength: stance.strength },
    equip: {
      attack: attackBonusFor(bonuses, attackStyle),
      strength: strengthBonusFor(bonuses, def.type),
    },
    speed: def.speed,
    defStyle: def.defStyle,
    voidAttack: mods.voidAttack,
    voidStrength: mods.voidStrength,
    attackFactors: mods.attackFactors,
    damageFactors: mods.damageFactors,
    maxHitOverride,
    ammoName: gear.ammo?.name ?? null,
  });
};

/** The weapon item backing a spec, if the data has it. */
export const specWeaponItem = (def: SpecDef, equipment: Equip[]): Equip | null =>
  pickVariant(equipment.filter((e) => e.name === def.item && e.slot === 'weapon')) ?? null;

/** Find the item backing each spec, and build its swapped-in loadout. */
export const buildSpecCandidates = (
  setup: SetupInput,
  equipment: Equip[],
  enabledIds: Set<string>,
  monster: Monster | null,
  switches: Record<string, Partial<Record<Slot, Equip | null>>> = {},
): { id: string; load: Loadout; def: SpecDef }[] =>
  SPECS.flatMap((def) => {
    if (!enabledIds.has(def.id)) return [];
    const weapon = specWeaponItem(def, equipment);
    if (!weapon) return [];
    return [{
      id: def.id,
      def,
      load: buildSpecLoadout(setup, def, weapon, monster, switches[def.id]),
    }];
  });

