import { describe, expect, it } from 'vitest';
import { specById } from './specs';
import { runSim } from './simulate';
import type { Loadout, Monster, SimEncounter, SimOptions } from './types';

/**
 * Defence drains are only worth using at the very start of a fight: the drain
 * pays for itself over the rest of the kill, so a drain landed halfway through
 * has half as long to pay back, and one landed near the end is pure loss.
 *
 * The simulation enforces that with an "opening" policy. These tests pin the
 * invariant down, because it is the kind of rule that quietly stops holding.
 */

const monster: Monster = {
  id: 1,
  name: 'Test dummy',
  version: null,
  size: 1,
  speed: 4,
  hp: 2000,
  def: 200,
  magic: 100,
  d: { stab: 50, slash: 50, crush: 50, magic: 50, standard: 50, light: 50, heavy: 50 },
  flatArmour: 0,
  attributes: [],
  isSlayerMonster: false,
};

const load = (name: string, maxHit: number, speed: number): Loadout => ({
  name, type: 'melee', attackRoll: 20_000, maxHit, speed, defStyle: 'slash',
});

const encounter: SimEncounter = {
  monster,
  // Deliberately feeble, so the kill is long and there is plenty of fight left
  // for a stray drain to land in.
  main: load('Main', 10, 4),
  specLoads: {
    dwh: load('Dragon warhammer', 30, 6),
    // Max hit 1, so the finisher takes the whole fight to chew through 2000 HP.
    // Energy needs ~250 ticks to reach a drain's worth, and the drain can only
    // be caught arriving late if the fight is still going by then.
    dragon_knife: load('Dragon knife', 1, 3),
  },
  count: 1,
  downtimeTicks: 0,
};

const opts = (startEnergy: number): SimOptions => ({
  startEnergy,
  lightbearer: false,
  trials: 60,
  seed: 99,
  kills: 1,
  downtimeTicks: 0,
  bankingTicks: 0,
  teamSize: 1,
  specOptions: {},
});

/**
 * Run a plan while recording the target's HP at the moment each drain lands.
 *
 * With a one-cast commitment the drain must be the fight's very first action,
 * so any cast seen at less than full HP means something attacked before it -
 * the drain came in mid-fight.
 *
 * `freeFinisher` makes the damage spec cost nothing and take one tick, so the
 * player can chain it forever and the main weapon never swings. That matters
 * because the opening used to end only on a main-weapon attack: without a
 * swing to end it, a drain could still land long into the fight once energy
 * had regenerated.
 */
const drainCastsAtHp = (startEnergy: number, freeFinisher: boolean): number[] => {
  const dwh = specById('dwh')!;
  const knife = specById('dragon_knife')!;
  const realHits = dwh.hits;
  const realCost = knife.cost;
  const realSpeed = knife.speed;

  const seen: number[] = [];
  try {
    dwh.hits = (ctx, max) => { seen.push(ctx.state.hp); return realHits(ctx, max); };
    if (freeFinisher) { knife.cost = 0; knife.speed = 1; }

    runSim({
      encounters: [encounter],
      plan: { id: 'test', drainId: 'dwh', drainCasts: 1, dpsId: 'dragon_knife' },
      opts: opts(startEnergy),
    });
  } finally {
    dwh.hits = realHits;
    knife.cost = realCost;
    knife.speed = realSpeed;
  }
  return seen;
};

describe('defence drains are an opening move', () => {
  it('treats every drain as opening-only', () => {
    for (const id of ['dwh', 'elder_maul', 'bgs', 'arclight', 'emberlight', 'accursed_sceptre', 'bone_dagger']) {
      const def = specById(id)!;
      expect(def.drains, id).toBe(true);
      // Either declared outright, or inherited from `drains` by specPolicy.
      expect(def.policy ?? 'opening', id).toBe('opening');
    }
  });

  it('drains on the opening attack when the energy is there', () => {
    const casts = drainCastsAtHp(100, false);
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((hp) => hp === monster.hp)).toBe(true);
  });

  it('never drains once damage specs have already opened the fight', () => {
    // No energy to drain with at the start, and a finisher that never yields
    // the turn back to the main weapon.
    const casts = drainCastsAtHp(0, true);
    const lateCasts = casts.filter((hp) => hp < monster.hp);
    expect(lateCasts).toEqual([]);
  });
});
