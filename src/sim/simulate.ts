import { accuracy } from './combat';
import { mulberry32, randInt } from './rng';
import { specPolicy, specById, type SpecCtx, type SpecDef } from './specs';
import type { Monster, MonsterState, SimOptions, SpecResult, Loadout } from './types';

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

/** Safety valve so a setup that cannot damage the target can never hang the worker. */
const MAX_TICKS = 20_000;

export interface SimInput {
  encounters: import('./types').SimEncounter[];
  specId: string | null;
  followUpSpecId?: string | null;
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

/** Returns a function to advance time, regenerating energy. */
const makeAdvance = (opts: SimOptions, state: EnergyState, tickCb: () => void) => (ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    tickCb();
    if (state.energy < 100) {
      if (--state.regenCounter <= 0) {
        state.energy = Math.min(100, state.energy + 10);
        state.regenCounter = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
      }
    }
  }
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
  encounter: import('./types').SimEncounter,
  spec: { def: SpecDef, load: Loadout } | null,
  followUp: { def: SpecDef, load: Loadout } | null,
  opts: SimOptions,
  rng: () => number,
  energy: EnergyState,
  isLastKill: boolean,
): KillOutcome => {
  const { monster, main } = encounter;

  const state = freshState(monster);
  const isDemon = monster.attributes.includes('demon');

  let ticks = 0;
  let energySpent = 0;
  let casts = 0;
  let primaryCasts = 0;
  /**
   * Defence drains are only worth using before you start hitting the target,
   * so once the main weapon swings, 'opening' specs are locked out for this kill.
   */
  let openingOver = false;
  let specHits = 0;

  const advance = makeAdvance(opts, energy, () => { ticks++; });

  while (state.hp > 0 && ticks < MAX_TICKS) {
    let activeSpec = spec;
    let isActiveFollowUp = false;

    if (spec) {
      const primaryCanSpec = energy.energy >= spec.def.cost
        && (specPolicy(spec.def) === 'greedy' || !openingOver)
        && (spec.def.maxCasts === undefined || primaryCasts < spec.def.maxCasts)
        && (spec.def.stopOnHit !== true || specHits === 0)
        && (isLastKill || state.hp > main.maxHit);

      if (!primaryCanSpec) {
        activeSpec = followUp;
        isActiveFollowUp = true;
      }
    } else if (followUp) {
      activeSpec = followUp;
      isActiveFollowUp = true;
    }

    const canSpec = activeSpec
      && energy.energy >= activeSpec.def.cost
      && (specPolicy(activeSpec.def) === 'greedy' || !openingOver)
      && (isLastKill || state.hp > main.maxHit);

    if (activeSpec && canSpec) {
      const acc = activeSpec.def.guaranteed
        ? 1
        : accuracy(activeSpec.load, monster, state, {
            styleOverride: activeSpec.def.defStyle,
            accuracyMultiplier: activeSpec.def.accMult,
          });

      const ctx: SpecCtx = {
        load: activeSpec.load,
        acc,
        rng,
        state,
        monsterName: monster.name,
        isDemon,
        options: opts.specOptions,
      };

      const specMax = activeSpec.def.maxHit(activeSpec.load.maxHit);
      const hits = activeSpec.def.hits(ctx, specMax);
      applyHits(state, hits);

      if (!isActiveFollowUp && hits.some(h => h > 0)) {
        specHits++;
      }

      energy.energy -= activeSpec.def.cost;
      energySpent += activeSpec.def.cost;
      casts++;
      if (!isActiveFollowUp) {
        primaryCasts++;
      }
      advance(activeSpec.def.speed);
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
  /** Per-encounter combat ticks (summed across all loops). */
  encTicks: number[];
  encEnergy: number[];
  encCasts: number[];
}

const simulateTrip = (
  input: SimInput,
  precomputedSpecs: ({ def: SpecDef, load: Loadout } | null)[],
  precomputedFollowUp: ({ def: SpecDef, load: Loadout } | null)[],
  rng: () => number
): TripOutcome => {
  const { opts, encounters } = input;
  const loops = Math.max(1, opts.kills); // opts.kills now represents loops per trip
  const energy: EnergyState = {
    energy: opts.startEnergy,
    regenCounter: opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS,
  };

  let combatTicks = 0;
  let totalTicks = 0;
  let energySpent = 0;
  let casts = 0;
  const killTicks: number[] = [];
  const encTicks = encounters.map(() => 0);
  const encEnergy = encounters.map(() => 0);
  const encCasts = encounters.map(() => 0);

  const idle = makeAdvance(opts, energy, () => { totalTicks++; });

  for (let loop = 0; loop < loops; loop++) {
    for (let eIdx = 0; eIdx < encounters.length; eIdx++) {
      const enc = encounters[eIdx];
      const isLastEncounterInTrip = (loop === loops - 1) && (eIdx === encounters.length - 1);

      // Downtime BEFORE this encounter starts
      if (enc.downtimeTicks > 0) {
        idle(enc.downtimeTicks);
      }

      let eT = 0;
      for (let k = 0; k < enc.count; k++) {
        const isLastKill = isLastEncounterInTrip && (k === enc.count - 1);
        const r = simulateKill(enc, precomputedSpecs[eIdx], precomputedFollowUp[eIdx], opts, rng, energy, isLastKill);
        eT += r.ticks;
        encEnergy[eIdx] += r.energySpent;
        encCasts[eIdx] += r.casts;
        combatTicks += r.ticks;
        totalTicks += r.ticks;
        energySpent += r.energySpent;
        casts += r.casts;
        killTicks.push(r.ticks);
      }
      encTicks[eIdx] += eT;
    }
  }

  if (opts.bankingTicks > 0) {
    totalTicks += opts.bankingTicks;
    energy.energy = 100;
    energy.regenCounter = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
  }

  return { combatTicks, totalTicks, energySpent, casts, killTicks, encTicks, encEnergy, encCasts };
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
  const out = Array.from({ length: buckets }, (_, i) => ({ tick: min + i * width, count: 0 }));
  for (const t of ticks) {
    const idx = Math.min(buckets - 1, Math.floor((t - min) / width));
    out[idx].count++;
  }
  return out;
};

type RawResult = Omit<SpecResult, 'secondsSaved' | 'secondsPer100Energy' | 'tripSecondsSaved'>;

/** Run the full Monte Carlo for one spec option (or the no-spec baseline). */
export const runSim = (input: SimInput): RawResult => {
  const { opts, specId, followUpSpecId, encounters } = input;
  const rng = mulberry32(opts.seed);
  const loops = Math.max(1, opts.kills);
  
  const specDef = specId ? specById(specId) : null;
  const precomputedSpecs = encounters.map(enc => {
    const load = specId ? enc.specLoads[specId] : null;
    return specDef && load ? { def: specDef, load } : null;
  });

  const followUpDef = followUpSpecId ? specById(followUpSpecId) : null;
  const precomputedFollowUp = encounters.map(enc => {
    const load = followUpSpecId ? enc.specLoads[followUpSpecId] : null;
    return followUpDef && load ? { def: followUpDef, load } : null;
  });

  const trips = opts.trials;

  const totalKillsPerTrip = encounters.reduce((sum, e) => sum + e.count, 0) * loops;

  const allKillTicks: number[] = [];
  let totalTripTicks = 0;
  let totalEnergy = 0;
  let totalCasts = 0;

  // Per-encounter accumulators (one sample per trial per encounter)
  const allEncTicks: number[][] = encounters.map(() => []);
  const encEnergySum = encounters.map(() => 0);
  const encCastsSum = encounters.map(() => 0);

  for (let i = 0; i < trips; i++) {
    const r = simulateTrip(input, precomputedSpecs, precomputedFollowUp, rng);
    totalTripTicks += r.totalTicks;
    totalEnergy += r.energySpent;
    totalCasts += r.casts;
    for (const t of r.killTicks) allKillTicks.push(t);
    for (let eIdx = 0; eIdx < encounters.length; eIdx++) {
      allEncTicks[eIdx].push(r.encTicks[eIdx]);
      encEnergySum[eIdx] += r.encEnergy[eIdx];
      encCastsSum[eIdx] += r.encCasts[eIdx];
    }
  }

  const sorted = [...allKillTicks].sort((a, b) => a - b);
  const meanTicks = allKillTicks.reduce((a, b) => a + b, 0) / allKillTicks.length;
  const meanTripTicks = totalTripTicks / trips;

  const breakdown = encounters.map((enc, eIdx) => {
    const sortedE = [...allEncTicks[eIdx]].sort((a, b) => a - b);
    const meanE = sortedE.reduce((a, b) => a + b, 0) / Math.max(1, sortedE.length);
    const kps = enc.count * loops;
    return {
      meanTicks: meanE,
      medianTicks: percentile(sortedE, 0.5),
      p90Ticks: percentile(sortedE, 0.9),
      meanSeconds: meanE * 0.6,
      tripSeconds: meanE * 0.6,
      energyUsed: kps > 0 ? (encEnergySum[eIdx] / trips / kps) : 0,
      meanSpecCasts: encCastsSum[eIdx] / trips,
      hist: histogram(allEncTicks[eIdx]),
      // secondsSaved will be filled in by compareSpecs
      secondsSaved: 0,
      tripSecondsSaved: 0,
      secondsPer100Energy: 0,
    };
  });

  return {
    specId: specId,
    specName: specDef?.name ?? 'No spec (baseline)',
    meanTicks,
    medianTicks: percentile(sorted, 0.5),
    p90Ticks: percentile(sorted, 0.9),
    meanSeconds: meanTicks * 0.6,
    tripSeconds: meanTripTicks * 0.6,
    energyUsed: totalKillsPerTrip > 0 ? (totalEnergy / trips / totalKillsPerTrip) : 0,
    meanSpecCasts: totalCasts / trips,
    hist: histogram(allKillTicks),
    breakdown,
  };
};

/**
 * Compare every candidate spec against the no-spec baseline for one encounter.
 * Results are sorted best-first by time saved.
 */
export const compareSpecs = (
  encounters: import('./types').SimEncounter[],
  specIds: string[],
  opts: SimOptions,
  followUpSpecId?: string | null,
): SpecResult[] => {
  const baseline = runSim({ encounters, specId: null, followUpSpecId, opts });

  const rows: SpecResult[] = specIds.map((specId) => {
    const r = runSim({ encounters, specId, followUpSpecId, opts });
    const secondsSaved = baseline.meanSeconds - r.meanSeconds;

    // Fill in per-encounter secondsSaved by comparing against baseline breakdown
    const breakdown = r.breakdown?.map((bd, i) => {
      const bBase = baseline.breakdown?.[i];
      const bSaved = bBase ? bBase.meanSeconds - bd.meanSeconds : 0;
      return {
        ...bd,
        secondsSaved: bSaved,
        tripSecondsSaved: bSaved, // per-encounter trip = same as meanSeconds diff
        secondsPer100Energy: bd.energyUsed > 0 ? (bSaved / bd.energyUsed) * 100 : 0,
      };
    });

    return {
      ...r,
      secondsSaved,
      tripSecondsSaved: baseline.tripSeconds - r.tripSeconds,
      // Efficiency: how much time each 100% of spec energy actually buys you.
      secondsPer100Energy: r.energyUsed > 0 ? (secondsSaved / r.energyUsed) * 100 : 0,
      breakdown,
    };
  });

  rows.sort((a, b) => b.secondsSaved - a.secondsSaved);

  // Baseline row: breakdown secondsSaved stay 0 (already set in runSim)
  return [
    { ...baseline, secondsSaved: 0, tripSecondsSaved: 0, secondsPer100Energy: 0 },
    ...rows,
  ];
};





