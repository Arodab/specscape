import { accuracy } from './combat';
import { mulberry32, randInt } from './rng';
import { specPolicy, type SpecCtx, type SpecDef } from './specs';
import type { Loadout, Monster, MonsterState, SimOptions, SpecResult } from './types';

/**
 * Monte Carlo kill simulation.
 *
 * The whole point of SpecScape: a spec is only worth using if the damage it adds
 * beats what your main weapon would have done during the ticks it costs. For
 * defence drains that payoff is spread over the rest of the kill, and the drain
 * itself shortens the kill - which shrinks the window it pays back over. That
 * feedback loop has no clean closed form, so we simulate it.
 *
 * Trip mode runs several kills back to back, carrying special attack energy (and
 * its regeneration) across them. That is what decides whether an expensive spec
 * is actually affordable on every kill or only on some of them.
 */

/** Special attack energy regenerates 10% every 50 ticks (30s), doubled by Lightbearer. */
const REGEN_TICKS = 50;
const REGEN_AMOUNT = 10;

/** Safety valve so a setup that cannot damage the target can never hang the worker. */
const MAX_TICKS = 20_000;

export interface SpecWeapon {
  def: SpecDef;
  load: Loadout;
}

export interface SimInput {
  monster: Monster;
  main: Loadout;
  spec: SpecWeapon | null;
  opts: SimOptions;
}

const freshState = (m: Monster): MonsterState => ({
  hp: m.hp,
  def: m.def,
  magic: m.magic,
  baseDef: m.def,
  baseAtk: 0,
  baseStr: 0,
});

/** Apply hitsplats in order, clamping each to remaining HP so overkill is wasted. */
const applyHits = (state: MonsterState, splats: number[]): void => {
  for (const splat of splats) {
    if (state.hp <= 0) return;
    state.hp -= Math.min(splat, state.hp);
  }
};

/** Special attack energy carried across kills within a trip. */
interface EnergyState {
  energy: number;
  regenCounter: number;
}

const makeAdvance = (opts: SimOptions, energy: EnergyState, onTick: () => void) => {
  const period = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
  return (n: number): void => {
    for (let i = 0; i < n; i++) {
      onTick();
      energy.regenCounter--;
      if (energy.regenCounter <= 0) {
        energy.energy = Math.min(100, energy.energy + REGEN_AMOUNT);
        energy.regenCounter = period;
      }
    }
  };
};

interface KillOutcome {
  ticks: number;
  energySpent: number;
  casts: number;
}

/**
 * Simulate a single kill, consuming from and regenerating into the shared
 * energy state.
 */
const simulateKill = (
  input: SimInput,
  rng: () => number,
  energy: EnergyState,
  isLastKill: boolean,
): KillOutcome => {
  const { monster, main, spec, opts } = input;
  const state = freshState(monster);
  const isDemon = monster.attributes.includes('demon');

  let ticks = 0;
  let energySpent = 0;
  let casts = 0;
  /**
   * Defence drains are only worth using before you start hitting the target,
   * so once the main weapon swings, 'opening' specs are locked out for this kill.
   */
  let openingOver = false;

  const advance = makeAdvance(opts, energy, () => { ticks++; });

  while (state.hp > 0 && ticks < MAX_TICKS) {
    const canSpec = spec
      && energy.energy >= spec.def.cost
      && (specPolicy(spec.def) === 'greedy' || !openingOver)
      && (isLastKill || state.hp > main.maxHit);

    if (spec && canSpec) {
      const acc = spec.def.guaranteed
        ? 1
        : accuracy(spec.load, monster, state, {
            styleOverride: spec.def.defStyle,
            accuracyMultiplier: spec.def.accMult,
          });

      const ctx: SpecCtx = {
        load: spec.load,
        acc,
        rng,
        state,
        monsterName: monster.name,
        isDemon,
        options: opts.specOptions,
      };

      const specMax = spec.def.maxHit(spec.load.maxHit);
      applyHits(state, spec.def.hits(ctx, specMax));

      energy.energy -= spec.def.cost;
      energySpent += spec.def.cost;
      casts++;
      advance(spec.def.speed);
      continue;
    }

    // Main weapon attack.
    openingOver = true;
    const acc = accuracy(main, monster, state);
    if (rng() < acc) {
      applyHits(state, [randInt(rng, 0, main.maxHit)]);
    }
    advance(main.speed);
  }

  return { ticks, energySpent, casts };
};

interface TripOutcome {
  /** Combat ticks only, summed across every kill in the trip. */
  combatTicks: number;
  /** Combat ticks plus the downtime between kills. */
  totalTicks: number;
  energySpent: number;
  casts: number;
  killTicks: number[];
}

const simulateTrip = (input: SimInput, rng: () => number): TripOutcome => {
  const { opts } = input;
  const kills = Math.max(1, opts.kills);
  const energy: EnergyState = {
    energy: opts.startEnergy,
    regenCounter: opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS,
  };

  let combatTicks = 0;
  let totalTicks = 0;
  let energySpent = 0;
  let casts = 0;
  const killTicks: number[] = [];

  // Downtime still regenerates energy, which is exactly why cheap specs win trips.
  const idle = makeAdvance(opts, energy, () => { totalTicks++; });

  for (let k = 0; k < kills; k++) {
    const r = simulateKill(input, rng, energy, k === kills - 1);
    combatTicks += r.ticks;
    totalTicks += r.ticks;
    energySpent += r.energySpent;
    casts += r.casts;
    killTicks.push(r.ticks);

    if (k < kills - 1 && opts.downtimeTicks > 0) idle(opts.downtimeTicks);
  }

  /**
   * Banking closes the trip. The player comes back with full energy, so unlike
   * downtime this is not a regeneration window - it is simply time on the clock.
   * It is also identical for every spec, so it lengthens the trip without
   * changing which spec comes out ahead.
   */
  if (opts.bankingTicks > 0) {
    totalTicks += opts.bankingTicks;
    energy.energy = 100;
    energy.regenCounter = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
  }

  return { combatTicks, totalTicks, energySpent, casts, killTicks };
};

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/** Bucket kill times into a histogram for the distribution view. */
const histogram = (ticks: number[], buckets = 40): { tick: number; count: number }[] => {
  let min = Infinity;
  let max = -Infinity;
  for (const t of ticks) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (max === min) return [{ tick: min, count: ticks.length }];
  const width = (max - min) / buckets;
  const counts = new Array(buckets).fill(0);
  for (const t of ticks) {
    counts[Math.min(buckets - 1, Math.floor((t - min) / width))]++;
  }
  return counts.map((count, i) => ({ tick: Math.round(min + (i + 0.5) * width), count }));
};

type RawResult = Omit<SpecResult, 'secondsSaved' | 'secondsPer100Energy' | 'tripSecondsSaved'>;

/** Run the full Monte Carlo for one spec option (or the no-spec baseline). */
export const runSim = (input: SimInput): RawResult => {
  const { opts, spec } = input;
  const rng = mulberry32(opts.seed);
  const kills = Math.max(1, opts.kills);
  const trips = opts.trials;

  const allKillTicks: number[] = [];
  let totalTripTicks = 0;
  let totalEnergy = 0;
  let totalCasts = 0;

  for (let i = 0; i < trips; i++) {
    const r = simulateTrip(input, rng);
    totalTripTicks += r.totalTicks;
    totalEnergy += r.energySpent;
    totalCasts += r.casts;
    for (const t of r.killTicks) allKillTicks.push(t);
  }

  const sorted = [...allKillTicks].sort((a, b) => a - b);
  const meanTicks = allKillTicks.reduce((a, b) => a + b, 0) / allKillTicks.length;
  const meanTripTicks = totalTripTicks / trips;

  return {
    specId: spec?.def.id ?? null,
    specName: spec?.def.name ?? 'No spec (baseline)',
    meanTicks,
    medianTicks: percentile(sorted, 0.5),
    p90Ticks: percentile(sorted, 0.9),
    meanSeconds: meanTicks * 0.6,
    tripSeconds: meanTripTicks * 0.6,
    energyUsed: totalEnergy / trips / kills,
    // Casts are reported per trip: "0.8 per kill" is far less useful than
    // "8 casts over the trip" when deciding whether a spec is affordable.
    meanSpecCasts: totalCasts / trips,
    hist: histogram(allKillTicks),
  };
};

/**
 * Compare every candidate spec against the no-spec baseline for one encounter.
 * Results are sorted best-first by time saved.
 */
export const compareSpecs = (
  monster: Monster,
  main: Loadout,
  candidates: SpecWeapon[],
  opts: SimOptions,
): SpecResult[] => {
  const baseline = runSim({ monster, main, spec: null, opts });

  const rows: SpecResult[] = candidates.map((spec) => {
    const r = runSim({ monster, main, spec, opts });
    const secondsSaved = baseline.meanSeconds - r.meanSeconds;
    return {
      ...r,
      secondsSaved,
      tripSecondsSaved: baseline.tripSeconds - r.tripSeconds,
      // Efficiency: how much time each 100% of spec energy actually buys you.
      secondsPer100Energy: r.energyUsed > 0 ? (secondsSaved / r.energyUsed) * 100 : 0,
    };
  });

  rows.sort((a, b) => b.secondsSaved - a.secondsSaved);

  return [
    { ...baseline, secondsSaved: 0, tripSecondsSaved: 0, secondsPer100Energy: 0 },
    ...rows,
  ];
};
