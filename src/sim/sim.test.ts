import { describe, it, expect } from 'vitest';
import { hitChance, npcDefenceRoll } from './combat';
import { SPECS, specById, factor } from './specs';
import { drainLimit } from './defenceFloors';
import { mulberry32 } from './rng';
import { buildLoadout, PRAYERS, STYLES } from './loadout';
import { compareSpecs, runSim } from './simulate';
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

describe('accuracy formula', () => {
  it('is symmetric around equal rolls', () => {
    // At equal rolls the attacker should be just under 50%.
    const c = hitChance(1000, 1000);
    expect(c).toBeGreaterThan(0.49);
    expect(c).toBeLessThan(0.5);
  });

  it('never exceeds 1 or drops below 0', () => {
    expect(hitChance(100000, 1)).toBeLessThanOrEqual(1);
    expect(hitChance(1, 100000)).toBeGreaterThanOrEqual(0);
  });

  it('scales the defence roll with level and bonus', () => {
    expect(npcDefenceRoll(100, 0)).toBe(109 * 64);
    expect(npcDefenceRoll(0, 0)).toBe(9 * 64);
  });
});

describe('defence drains', () => {
  it('DWH removes 30% of current defence', () => {
    const m = findMonster('Vorkath');
    const state = stateOf(m);
    const before = state.def;
    const dwh = specById('dwh')!;
    // Force a hit by using acc = 1.
    dwh.hits(
      { load: {} as never, acc: 1, rng: mulberry32(1), state, monsterName: m.name, isDemon: false, options: {} },
      10,
    );
    expect(state.def).toBe(before - factor(before, 3, 10));
  });

  it('elder maul drains harder than DWH', () => {
    const m = findMonster('Vorkath');
    const dwhState = stateOf(m);
    const maulState = stateOf(m);
    const ctx = (state: MonsterState) => ({
      load: {} as never, acc: 1, rng: mulberry32(1), state, monsterName: m.name, isDemon: false, options: {},
    });
    specById('dwh')!.hits(ctx(dwhState), 10);
    specById('elder_maul')!.hits(ctx(maulState), 10);
    expect(maulState.def).toBeLessThan(dwhState.def);
  });

  it('respects the Nex defence floor of 250', () => {
    expect(drainLimit('Nex', 300).floor).toBe(250);
  });

  it('treats Vardorvis as undrainable', () => {
    const limit = drainLimit('Vardorvis', 215);
    expect(limit.immune).toBe(true);
    expect(limit.floor).toBe(215);
  });

  it('leaves normal monsters with no floor', () => {
    expect(drainLimit('Vorkath', 214).floor).toBe(0);
  });
});

describe('voidwaker', () => {
  it('always rolls between 50% and 150% of max hit', () => {
    const vw = specById('voidwaker')!;
    const base = 60;
    const specMax = vw.maxHit(base);
    expect(specMax).toBe(90);

    const rng = mulberry32(7);
    const state = stateOf(findMonster('Vorkath'));
    for (let i = 0; i < 2000; i++) {
      const [dmg] = vw.hits(
        { load: {} as never, acc: 1, rng, state, monsterName: 'Vorkath', isDemon: false, options: {} },
        specMax,
      );
      expect(dmg).toBeGreaterThanOrEqual(30);
      expect(dmg).toBeLessThanOrEqual(90);
    }
  });
});

describe('dragon claws', () => {
  it('averages close to the max hit when accuracy is perfect', () => {
    const claws = specById('dragon_claws')!;
    const rng = mulberry32(42);
    const state = stateOf(findMonster('Vorkath'));
    const max = 50;
    let total = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const splats = claws.hits(
        { load: {} as never, acc: 1, rng, state, monsterName: 'Vorkath', isDemon: false, options: {} },
        max,
      );
      total += splats.reduce((a, b) => a + b, 0);
    }
    const mean = total / n;
    // A guaranteed first-roll claws hit lands roughly max..2*max split four ways.
    expect(mean).toBeGreaterThan(max * 0.9);
    expect(mean).toBeLessThan(max * 1.6);
  });
});

/** Max melee: 99s, super combat, piety, Ghrazi rapier-tier bonuses. */
const maxMelee = () =>
  buildLoadout({
    name: 'Max melee (rapier)',
    type: 'melee',
    levels: { attack: 99, strength: 99, ranged: 99, magic: 99 },
    boosts: { attack: 19, strength: 19, ranged: 0, magic: 0 },
    prayers: PRAYERS.piety,
    style: STYLES.accurate,
    equip: { attack: 94, strength: 138 },
    speed: 4,
    defStyle: 'stab',
  });

describe('loadout maths', () => {
  it('produces a plausible max melee hit', () => {
    const l = maxMelee();
    // Max melee with these bonuses should sit in the mid 50s.
    expect(l.maxHit).toBeGreaterThan(45);
    expect(l.maxHit).toBeLessThan(65);
    expect(l.attackRoll).toBeGreaterThan(20000);
  });
});

describe('integration: specs vs Vorkath', () => {
  const opts = { startEnergy: 100, lightbearer: false, trials: 3000, seed: 99, kills: 1, downtimeTicks: 0, bankingTicks: 0, specOptions: {} };

  it('baseline kill time is plausible', () => {
    const vorkath = findMonster('Vorkath');
    const r = runSim({ monster: vorkath, main: maxMelee(), spec: null, opts });
    // 750 HP boss - a real max melee kill is on the order of a minute.
    expect(r.meanSeconds).toBeGreaterThan(20);
    expect(r.meanSeconds).toBeLessThan(200);
  });

  it('ranks specs and never reports the baseline as saving time', () => {
    const vorkath = findMonster('Vorkath');
    const main = maxMelee();
    const candidates = ['voidwaker', 'dwh', 'elder_maul', 'sgs', 'dragon_claws', 'bgs'].map((id) => {
      const def = specById(id)!;
      return {
        def,
        load: buildLoadout({
          name: def.name,
          type: 'melee',
          levels: { attack: 99, strength: 99, ranged: 99, magic: 99 },
          boosts: { attack: 19, strength: 19, ranged: 0, magic: 0 },
          prayers: PRAYERS.piety,
          style: STYLES.accurate,
          equip: { attack: 80, strength: 100 },
          speed: def.speed,
          defStyle: def.defStyle,
        }),
      };
    });

    const rows = compareSpecs(vorkath, main, candidates, opts);
    expect(rows[0].specName).toBe('No spec (baseline)');
    expect(rows[0].secondsSaved).toBe(0);

    const specRows = rows.slice(1);
    expect(specRows.length).toBe(6);
    // Sorted best-first.
    for (let i = 1; i < specRows.length; i++) {
      expect(specRows[i - 1].secondsSaved).toBeGreaterThanOrEqual(specRows[i].secondsSaved);
    }
    // Every spec should actually consume energy.
    specRows.forEach((r) => expect(r.energyUsed).toBeGreaterThan(0));
  });
});

describe('spec registry integrity', () => {
  it('has unique ids and sane costs', () => {
    const ids = SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    SPECS.forEach((s) => {
      expect(s.cost).toBeGreaterThan(0);
      expect(s.cost).toBeLessThanOrEqual(100);
      expect(s.speed).toBeGreaterThan(0);
    });
  });
});
