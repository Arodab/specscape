import { describe, it, expect } from 'vitest';
import { baneFor, baneWeaponsFor, BANE_WEAPONS } from './bane';
import { resolveModifiers, DEFAULT_BUFFS } from './modifiers';
import { defaultSortForType } from '../ui/GearGrid';
import type { Equip, GearSet } from './gear';
import type { Monster } from './types';
import monstersData from '../../public/data/monsters.json';
import equipmentData from '../../public/data/equipment.json';

const monsters = monstersData as unknown as Monster[];
const equipment = equipmentData as unknown as Equip[];
const findMonster = (name: string): Monster => {
  const m = monsters.find((x) => x.name === name);
  if (!m) throw new Error(`monster not found: ${name}`);
  return m;
};
const weapon = (name: string): GearSet => {
  const item = equipment.find((e) => e.name === name && e.slot === 'weapon');
  if (!item) throw new Error(`weapon not found: ${name}`);
  return { weapon: item };
};

describe('bane weapons', () => {
  it('matches only against the right monster type', () => {
    expect(baneFor('Arclight', ['demon'])?.label).toMatch(/demonbane/);
    expect(baneFor('Arclight', ['dragon'])).toBeNull();
    expect(baneFor('Dragon hunter crossbow', ['dragon'])?.label).toMatch(/dragonbane/);
    expect(baneFor('Dragon hunter crossbow', ['demon'])).toBeNull();
    expect(baneFor('Ghrazi rapier', ['dragon'])).toBeNull();
    expect(baneFor(null, ['demon'])).toBeNull();
    expect(baneFor('Arclight', [])).toBeNull();
  });

  it('treats every vampyre tier as one', () => {
    for (const tier of ['vampyre1', 'vampyre2', 'vampyre3']) {
      expect(baneFor('Blisterwood flail', [tier])).not.toBeNull();
    }
  });

  it('lists what would work against a target', () => {
    const vs = baneWeaponsFor(['demon']).map((b) => b.label);
    expect(vs.some((l) => /demonbane \+70%/.test(l))).toBe(true);
    expect(baneWeaponsFor([])).toEqual([]);
    expect(baneWeaponsFor(null)).toEqual([]);
  });

  it('every entry declares at least one bonus', () => {
    for (const b of BANE_WEAPONS) {
      expect(b.accuracy || b.damage, `${b.label} has a bonus`).toBeTruthy();
      expect(b.attributes.length).toBeGreaterThan(0);
    }
  });
});

describe('bane bonuses reach the simulation', () => {
  it('applies dragonbane against a dragon and not otherwise', () => {
    const vorkath = findMonster('Vorkath'); // dragon
    const graardor = findMonster('General Graardor'); // not a dragon

    const on = resolveModifiers(DEFAULT_BUFFS, weapon('Dragon hunter crossbow'), vorkath, 'ranged');
    expect(on.attackFactors).toContainEqual([13, 10]);
    expect(on.damageFactors).toContainEqual([5, 4]);
    expect(on.applied.join()).toMatch(/dragonbane/);

    const off = resolveModifiers(DEFAULT_BUFFS, weapon('Dragon hunter crossbow'), graardor, 'ranged');
    expect(off.attackFactors).toHaveLength(0);
    expect(off.damageFactors).toHaveLength(0);
  });

  it('applies demonbane to Arclight against demons', () => {
    const demon = findMonster('Abyssal demon');
    const mods = resolveModifiers(DEFAULT_BUFFS, weapon('Arclight'), demon, 'melee');
    expect(mods.attackFactors).toContainEqual([17, 10]);
    expect(mods.damageFactors).toContainEqual([17, 10]);
  });
});

describe('picker default sort', () => {
  it('follows the attack type of the equipped style', () => {
    expect(defaultSortForType('melee')).toBe('str');
    expect(defaultSortForType('ranged')).toBe('ranged_str');
    expect(defaultSortForType('magic')).toBe('magic_str');
  });
});
