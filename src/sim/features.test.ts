import { describe, it, expect } from 'vitest';
import { resolveModifiers, DEFAULT_BUFFS } from './modifiers';
import { specById, specPolicy } from './specs';
import { mulberry32 } from './rng';
import { buildLoadout, PRAYERS, STYLES } from './loadout';
import { runSim } from './simulate';
import type { Equip, GearSet } from './gear';
import type { Monster, MonsterState } from './types';
import monstersData from '../../public/data/monsters.json';

const monsters = monstersData as unknown as Monster[];
const findMonster = (name: string): Monster => {
  const m = monsters.find((x) => x.name === name);
  if (!m) throw new Error(`monster not found: ${name}`);
  return m;
};

const stateOf = (m: Monster): MonsterState => ({
  hp: m.hp, def: m.def, magic: m.magic, baseDef: m.def, baseAtk: 0, baseStr: 0,
});

const LEVELS = { attack: 99, strength: 99, ranged: 99, magic: 99 };
const BOOSTS = { attack: 19, strength: 19, ranged: 0, magic: 0 };

const maxMelee = () =>
  buildLoadout({
    name: 'Max melee', type: 'melee', levels: LEVELS, boosts: BOOSTS,
    prayers: PRAYERS.piety, style: STYLES.accurate,
    equip: { attack: 94, strength: 138 }, speed: 4, defStyle: 'stab',
  });

const fakeItem = (name: string, slot: string): Equip => ({
  id: 1, name, slot: slot as Equip['slot'], version: null, speed: 4,
  category: 'Bow', twoHanded: false, image: null,
  o: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0, str: 0, ranged_str: 0, magic_str: 0 },
});

describe('gear multipliers, detected from equipped gear', () => {
  const vorkath = findMonster('Vorkath'); // undead and a slayer monster
  const graardor = findMonster('General Graardor'); // neither

  const neck = (name: string): GearSet => ({ neck: fakeItem(name, 'neck') });
  const head = (name: string): GearSet => ({ head: fakeItem(name, 'head') });

  it('applies salve only when it is actually worn, and only to undead', () => {
    const worn = resolveModifiers(DEFAULT_BUFFS, neck('Salve amulet (e)'), vorkath, 'melee');
    expect(worn.damageFactors).toContainEqual([6, 5]);

    const notUndead = resolveModifiers(DEFAULT_BUFFS, neck('Salve amulet (e)'), graardor, 'melee');
    expect(notUndead.damageFactors).toHaveLength(0);
    expect(notUndead.applied.join()).toMatch(/not undead/i);

    const noSalve = resolveModifiers(DEFAULT_BUFFS, neck('Amulet of rancour'), vorkath, 'melee');
    expect(noSalve.damageFactors).toHaveLength(0);
  });

  it('distinguishes the enchanted salve from the plain one', () => {
    const plain = resolveModifiers(DEFAULT_BUFFS, neck('Salve amulet(i)'), vorkath, 'melee');
    expect(plain.damageFactors).toEqual([[7, 6]]);
    const enchanted = resolveModifiers(DEFAULT_BUFFS, neck('Salve amulet(ei)'), vorkath, 'melee');
    expect(enchanted.damageFactors).toEqual([[6, 5]]);
  });

  it('does not stack salve with the slayer helmet', () => {
    const both: GearSet = {
      neck: fakeItem('Salve amulet (e)', 'neck'),
      head: fakeItem('Slayer helmet (i)', 'head'),
    };
    // Salve takes priority; the mask must not add a second factor.
    expect(resolveModifiers(DEFAULT_BUFFS, both, vorkath, 'melee').damageFactors)
      .toEqual([[6, 5]]);
  });

  it('applies a worn slayer helmet unless forced off task', () => {
    const onTask = resolveModifiers(DEFAULT_BUFFS, head('Slayer helmet (i)'), vorkath, 'melee');
    expect(onTask.damageFactors).toEqual([[7, 6]]);

    const offTask = resolveModifiers({ offTask: true }, head('Slayer helmet (i)'), vorkath, 'melee');
    expect(offTask.damageFactors).toHaveLength(0);
    expect(offTask.applied.join()).toMatch(/off task/i);

    // Graardor is boss-task assignable, so use one that genuinely is not.
    const corp = findMonster('Corporeal Beast');
    const notSlayer = resolveModifiers(DEFAULT_BUFFS, head('Slayer helmet (i)'), corp, 'melee');
    expect(notSlayer.damageFactors).toHaveLength(0);
    expect(notSlayer.applied.join()).toMatch(/not a slayer monster/i);
  });

  it('needs the whole void set before void does anything', () => {
    const partial: GearSet = {
      head: fakeItem('Void ranger helm', 'head'),
      body: fakeItem('Elite void top', 'body'),
    };
    expect(resolveModifiers(DEFAULT_BUFFS, partial, graardor, 'ranged').voidAttack).toBe(1);

    const full: GearSet = {
      head: fakeItem('Void ranger helm', 'head'),
      body: fakeItem('Elite void top', 'body'),
      legs: fakeItem('Elite void robe', 'legs'),
      hands: fakeItem('Void knight gloves', 'hands'),
    };
    const elite = resolveModifiers(DEFAULT_BUFFS, full, graardor, 'ranged');
    expect(elite.voidAttack).toBeCloseTo(1.1);
    // Elite ranged void is 9/8 damage, better than the regular set's 11/10.
    expect(elite.voidStrength).toBeCloseTo(1.125);
  });

  it('gives regular void less damage than elite void', () => {
    const regular: GearSet = {
      head: fakeItem('Void ranger helm', 'head'),
      body: fakeItem('Void knight top', 'body'),
      legs: fakeItem('Void knight robe', 'legs'),
      hands: fakeItem('Void knight gloves', 'hands'),
    };
    expect(resolveModifiers(DEFAULT_BUFFS, regular, graardor, 'ranged').voidStrength)
      .toBeCloseTo(1.1);
  });

  it('ignores void worn for the wrong attack type', () => {
    const rangedSet: GearSet = {
      head: fakeItem('Void ranger helm', 'head'),
      body: fakeItem('Elite void top', 'body'),
      legs: fakeItem('Elite void robe', 'legs'),
      hands: fakeItem('Void knight gloves', 'hands'),
    };
    const mismatch = resolveModifiers(DEFAULT_BUFFS, rangedSet, graardor, 'melee');
    expect(mismatch.voidAttack).toBe(1);
    expect(mismatch.applied.join()).toMatch(/void inactive/i);
  });

  it('applies crystal armour only alongside a crystal bow', () => {
    const withBow: GearSet = {
      weapon: fakeItem('Bow of Faerdhinen', 'weapon'),
      head: fakeItem('Crystal helm', 'head'),
      body: fakeItem('Crystal body', 'body'),
      legs: fakeItem('Crystal legs', 'legs'),
    };
    const on = resolveModifiers(DEFAULT_BUFFS, withBow, graardor, 'ranged');
    expect(on.attackFactors).toContainEqual([26, 20]); // 20 + all 6 pieces
    expect(on.damageFactors).toContainEqual([46, 40]);

    const withoutBow: GearSet = { ...withBow, weapon: fakeItem('Twisted bow', 'weapon') };
    expect(resolveModifiers(DEFAULT_BUFFS, withoutBow, graardor, 'ranged').attackFactors)
      .toHaveLength(0);
  });

  it('feeds through to a real max hit', () => {
    const plain = buildLoadout({
      name: 'x', type: 'melee', levels: LEVELS, boosts: BOOSTS,
      prayers: PRAYERS.piety, style: { attack: 3, strength: 0 },
      equip: { attack: 94, strength: 138 }, speed: 4, defStyle: 'stab',
    });
    const salved = buildLoadout({
      name: 'x', type: 'melee', levels: LEVELS, boosts: BOOSTS,
      prayers: PRAYERS.piety, style: { attack: 3, strength: 0 },
      equip: { attack: 94, strength: 138 }, speed: 4, defStyle: 'stab',
      damageFactors: [[6, 5]], attackFactors: [[6, 5]],
    });
    expect(salved.maxHit).toBe(Math.trunc((plain.maxHit * 6) / 5));
    expect(salved.attackRoll).toBeGreaterThan(plain.attackRoll);
  });
});

describe('Zaryte crossbow spec', () => {
  it('deals 22% of the target current HP, capped at 110', () => {
    const zcb = specById('zcb')!;
    const state = stateOf(findMonster('Vorkath'));
    const ctx = {
      load: {} as never, acc: 1, rng: mulberry32(3), state, monsterName: 'Vorkath', isDemon: false, options: {},
    };

    state.hp = 400;
    expect(zcb.hits(ctx, 0)).toEqual([88]);

    state.hp = 3000;
    expect(zcb.hits(ctx, 0)).toEqual([110]); // capped

    state.hp = 50;
    expect(zcb.hits(ctx, 0)).toEqual([11]); // near-useless on low-HP targets
  });

  it('still has to land the attack - the proc is not unconditional', () => {
    // The ruby effect is only guaranteed on an accurate hit, so speccing a ZCB
    // out of a melee setup (no ranged gear, no rigour) must be able to whiff.
    const zcb = specById('zcb')!;
    expect(zcb.guaranteed).toBeFalsy();
    const state = stateOf(findMonster('Vorkath'));
    state.hp = 400;
    const miss = zcb.hits(
      { load: {} as never, acc: 0, rng: mulberry32(3), state, monsterName: 'Vorkath', isDemon: false, options: {} },
      0,
    );
    expect(miss).toEqual([0]);
    expect(state.hp).toBe(400);
  });
});

describe('spec policy', () => {
  it('restricts defence drains to the opening of a fight', () => {
    expect(specPolicy(specById('dwh')!)).toBe('opening');
    expect(specPolicy(specById('elder_maul')!)).toBe('opening');
    expect(specPolicy(specById('bgs')!)).toBe('opening');
    expect(specPolicy(specById('voidwaker')!)).toBe('greedy');
    expect(specPolicy(specById('dragon_claws')!)).toBe('greedy');
  });

  it('never casts a drain spec once the main weapon has swung', () => {
    // A long kill with Lightbearer regenerates plenty of energy. A greedy policy
    // would keep firing all fight; the opening policy must stop after the first burst.
    const tank: Monster = { ...findMonster('Vorkath'), hp: 4000 };
    const dwh = specById('dwh')!;
    const load = buildLoadout({
      name: 'dwh', type: 'melee', levels: LEVELS, boosts: BOOSTS,
      prayers: PRAYERS.piety, style: STYLES.accurate,
      equip: { attack: 95, strength: 85 }, speed: 6, defStyle: 'crush',
    });

    const r = runSim({
      monster: tank, main: maxMelee(), spec: { def: dwh, load },
      opts: { startEnergy: 100, lightbearer: true, trials: 400, seed: 5, kills: 1, downtimeTicks: 0, bankingTicks: 0, specOptions: {} },
    });
    // 100% energy buys exactly two 50% casts, and nothing after that.
    expect(r.meanSpecCasts).toBeLessThanOrEqual(2);
    expect(r.meanSpecCasts).toBeGreaterThan(1.5);
  });
});

describe('trip mode', () => {
  const main = maxMelee();
  const target = findMonster('Abyssal demon');
  const loadFor = (id: string) => {
    const def = specById(id)!;
    return buildLoadout({
      name: def.name, type: 'melee', levels: LEVELS, boosts: BOOSTS,
      prayers: PRAYERS.piety, style: STYLES.accurate,
      equip: { attack: 80, strength: 90 }, speed: def.speed, defStyle: def.defStyle,
    });
  };

  it('carries spec energy across kills instead of resetting it', () => {
    const def = specById('voidwaker')!;
    const r = runSim({
      monster: target, main, spec: { def, load: loadFor('voidwaker') },
      opts: {
        startEnergy: 100, lightbearer: false, trials: 300, seed: 11,
        kills: 10, downtimeTicks: 0, bankingTicks: 0, specOptions: {},
      },
    });
    // Casts are reported per trip. 100% start funds exactly two 50% casts, and
    // with no downtime there is very little regen across a 10-kill trip.
    expect(r.meanSpecCasts).toBeGreaterThanOrEqual(2);
    expect(r.meanSpecCasts).toBeLessThan(10);
    expect(r.tripSeconds).toBeGreaterThan(r.meanSeconds);
  });

  it('lets cheap specs be used more often per kill than expensive ones', () => {
    const opts = {
      startEnergy: 100, lightbearer: false, trials: 300, seed: 11,
      kills: 10, downtimeTicks: 100, bankingTicks: 0, specOptions: {},
    };
    const cheap = runSim({
      monster: target, main,
      spec: { def: specById('dragon_dagger')!, load: loadFor('dragon_dagger') },
      opts,
    });
    const pricey = runSim({
      monster: target, main,
      spec: { def: specById('zcb')!, load: loadFor('zcb') },
      opts,
    });
    expect(cheap.meanSpecCasts).toBeGreaterThan(pricey.meanSpecCasts);
  });

  it('counts downtime in the trip total but not in per-kill time', () => {
    const base = { startEnergy: 100, lightbearer: false, trials: 200, seed: 7, kills: 5 };
    const noIdle = runSim({
      monster: target, main, spec: null, opts: { ...base, downtimeTicks: 0, bankingTicks: 0, specOptions: {} },
    });
    const idle = runSim({
      monster: target, main, spec: null, opts: { ...base, downtimeTicks: 100, bankingTicks: 0, specOptions: {} },
    });
    expect(idle.meanSeconds).toBeCloseTo(noIdle.meanSeconds, 1);
    // 4 gaps of 100 ticks = 400 ticks = 240 seconds.
    expect(idle.tripSeconds - noIdle.tripSeconds).toBeCloseTo(240, 0);
  });
});

describe('banking time', () => {
  const main = maxMelee();
  const target = findMonster('Abyssal demon');
  const base = {
    startEnergy: 100, lightbearer: false, trials: 200, seed: 21,
    kills: 5, downtimeTicks: 0,
  };

  it('adds to the trip total but never to kill time', () => {
    const none = runSim({
      monster: target, main, spec: null, opts: { ...base, bankingTicks: 0, specOptions: {} },
    });
    const banked = runSim({
      monster: target, main, spec: null, opts: { ...base, bankingTicks: 200, specOptions: {} },
    });

    expect(banked.meanSeconds).toBeCloseTo(none.meanSeconds, 5);
    // 200 ticks = 120 seconds, once per trip rather than once per kill.
    expect(banked.tripSeconds - none.tripSeconds).toBeCloseTo(120, 5);
  });

  it('does not act as a regeneration window', () => {
    // Banking closes the trip and the player returns with full energy, so a long
    // bank must not hand out extra casts the way downtime does.
    const def = specById('voidwaker')!;
    const load = buildLoadout({
      name: def.name, type: 'melee', levels: LEVELS, boosts: BOOSTS,
      prayers: PRAYERS.piety, style: STYLES.accurate,
      equip: { attack: 80, strength: 90 }, speed: def.speed, defStyle: def.defStyle,
    });
    const short = runSim({
      monster: target, main, spec: { def, load }, opts: { ...base, bankingTicks: 0, specOptions: {} },
    });
    const long = runSim({
      monster: target, main, spec: { def, load }, opts: { ...base, bankingTicks: 2000, specOptions: {} },
    });
    expect(long.meanSpecCasts).toBeCloseTo(short.meanSpecCasts, 5);
  });
});
