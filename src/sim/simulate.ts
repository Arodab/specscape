import { accuracy } from './combat';
import { mulberry32, randInt } from './rng';
import { specPolicy, specById, type SpecCtx, type SpecDef } from './specs';
import { BASELINE_PLAN, comboCost, planLabel, type SpecPlan } from './plans';
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
  plan: SpecPlan;
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
  const teamSize = opts.teamSize ?? 1;
  const maxEnergy = 100 * teamSize;
  const regenAmount = 10 * teamSize;
  for (let i = 0; i < ticks; i++) {
    tickCb();
    if (state.energy < maxEnergy) {
      if (--state.regenCounter <= 0) {
        state.energy = Math.min(maxEnergy, state.energy + regenAmount);
        state.regenCounter = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
      }
    }
  }
};

/** Did any hitsplat land? Hand-rolled to keep a closure out of the cast path. */
const anyHit = (splats: number[]): boolean => {
  for (let i = 0; i < splats.length; i++) if (splats[i] > 0) return true;
  return false;
};

interface KillOutcome {
  ticks: number;
  energySpent: number;
  casts: number;
}

/**
 * A spec as this run will actually use it. `maxCasts`/`stopOnHit` live here
 * rather than on the def because how many drains you commit to is the player's
 * decision and the thing the search varies - the def only sets a hard ceiling
 * where the game imposes one (the bone dagger's single use per target).
 */
type SpecEntry = { def: SpecDef; load: Loadout; maxCasts: number; stopOnHit: boolean };

/**
 * Everything about one encounter that is fixed for the whole run.
 *
 * Kills are short - often well under a hundred ticks - so anything recomputed
 * per kill is paid hundreds of thousands of times across a Monte Carlo run and
 * can rival the tick loop itself. Resolving it once per encounter (including
 * the scratch objects the loop mutates) keeps the per-kill prologue down to
 * resetting a handful of fields.
 */
interface EncounterPlan {
  monster: Monster;
  main: Loadout;
  mainMaxHit: number;
  mainSpeed: number;
  /** Magic attacks roll against the monster's Magic level, not its Defence. */
  mainUsesMagic: boolean;
  spec: SpecEntry | null;
  specGreedy: boolean;
  followUp: SpecEntry | null;
  followUpGreedy: boolean;
  count: number;
  downtimeTicks: number;
  /**
   * Energy the shared pool must hold at the start of a kill before this plan
   * will open at all. 0 means spend whatever is available (the default).
   */
  holdUntil: number;
  /** Scratch, reused by every kill of this encounter. */
  state: MonsterState;
  ctx: SpecCtx;
  playerCooldowns: Int32Array;
}

/** Energy regeneration constants, fixed for a whole run. */
interface EnergyConf {
  teamSize: number;
  maxEnergy: number;
  regenAmount: number;
  regenPeriod: number;
}

const makePlan = (
  enc: import('./types').SimEncounter,
  spec: SpecEntry | null,
  followUp: SpecEntry | null,
  opts: SimOptions,
  rng: () => number,
  teamSize: number,
  holdUntil: number,
): EncounterPlan => {
  const { monster, main } = enc;
  const state = freshState(monster);
  return {
    monster,
    main,
    mainMaxHit: main.maxHit,
    mainSpeed: main.speed,
    mainUsesMagic: main.defStyle === 'magic',
    spec,
    specGreedy: spec ? specPolicy(spec.def) === 'greedy' : false,
    followUp,
    followUpGreedy: followUp ? specPolicy(followUp.def) === 'greedy' : false,
    count: enc.count,
    downtimeTicks: enc.downtimeTicks,
    holdUntil,
    state,
    ctx: {
      load: main,
      acc: 0,
      rng,
      state,
      monsterName: monster.name,
      isDemon: monster.attributes.includes('demon'),
      options: opts.specOptions,
    },
    playerCooldowns: new Int32Array(teamSize),
  };
};

/**
 * Simulate a single kill, consuming from and regenerating into the shared
 * energy state.
 */
const simulateKill = (
  plan: EncounterPlan,
  conf: EnergyConf,
  rng: () => number,
  energy: EnergyState,
  isLastKill: boolean,
): KillOutcome => {
  const {
    monster, main, mainMaxHit, mainSpeed, mainUsesMagic,
    specGreedy, followUpGreedy, state, ctx, playerCooldowns,
  } = plan;
  const { teamSize, maxEnergy, regenAmount, regenPeriod } = conf;

  /**
   * A banked plan sits out any kill it cannot open properly, so the energy
   * rolls forward to one it can. The call is made once, up front - that is the
   * decision a player actually makes when they look at their spec bar.
   */
  const opening = plan.holdUntil === 0 || energy.energy >= plan.holdUntil;
  const spec = opening ? plan.spec : null;
  const followUp = opening ? plan.followUp : null;

  // Reset the scratch state for this kill.
  state.hp = monster.hp;
  state.def = monster.def;
  state.magic = monster.magic;
  state.baseDef = monster.def;
  state.baseAtk = 0;
  state.baseStr = 0;
  playerCooldowns.fill(0);

  let ticks = 0;
  let energySpent = 0;
  let casts = 0;
  let primaryCasts = 0;
  let openingOver = false;
  let specHits = 0;

  /**
   * Main-weapon accuracy only moves when the stat it rolls against is drained,
   * so recomputing it every tick is pure waste - on a no-drain setup it is the
   * same number for the entire kill.
   */
  let accLevel = -1;
  let mainAcc = 0;

  while (state.hp > 0 && ticks < MAX_TICKS) {
    let someoneAttacked = false;

    for (let p = 0; p < teamSize; p++) {
      if (state.hp <= 0) break;
      if (playerCooldowns[p] > 0) continue;

      let activeSpec = spec;
      let isActiveFollowUp = false;
      let activeGreedy = specGreedy;

      if (spec) {
        const primaryCanSpec = energy.energy >= spec.def.cost
          && (specGreedy || !openingOver)
          && primaryCasts < spec.maxCasts
          && (!spec.stopOnHit || specHits === 0)
          && (isLastKill || state.hp > mainMaxHit);

        if (!primaryCanSpec) {
          activeSpec = followUp;
          isActiveFollowUp = true;
          activeGreedy = followUpGreedy;
        }
      } else if (followUp) {
        activeSpec = followUp;
        isActiveFollowUp = true;
        activeGreedy = followUpGreedy;
      }

      const canSpec = activeSpec
        && energy.energy >= activeSpec.def.cost
        && (activeGreedy || !openingOver)
        && (isLastKill || state.hp > mainMaxHit);

      if (activeSpec && canSpec) {
        const def = activeSpec.def;
        const acc = def.guaranteed
          ? 1
          : accuracy(activeSpec.load, monster, state, {
              styleOverride: def.defStyle,
              accuracyMultiplier: def.accMult,
            });

        ctx.load = activeSpec.load;
        ctx.acc = acc;

        const hits = def.hits(ctx, def.maxHit(activeSpec.load.maxHit));
        applyHits(state, hits);

        if (!isActiveFollowUp && anyHit(hits)) {
          specHits++;
        }

        energy.energy -= def.cost;
        energySpent += def.cost;
        casts++;
        if (!isActiveFollowUp) {
          primaryCasts++;
        }
        /**
         * The opening lasts only while the player is still casting the opener.
         * A damage spec ends it just as a main-weapon swing does, so a Defence
         * drain can never land in the middle of a fight - by the time the drain
         * would pay off there is not enough kill left to pay it back.
         *
         * Without this the opening only ended on a main-weapon attack, so a
         * fight that opened with damage specs (because the drain was not yet
         * affordable) could still drain later, once energy regenerated.
         */
        if (activeGreedy) openingOver = true;

        playerCooldowns[p] = def.speed;
        someoneAttacked = true;
        continue;
      }

      // Main weapon attack.
      openingOver = true;
      const lvl = mainUsesMagic ? state.magic : state.def;
      if (lvl !== accLevel) {
        accLevel = lvl;
        mainAcc = accuracy(main, monster, state);
      }
      if (rng() < mainAcc) {
        const dmg = randInt(rng, 0, mainMaxHit);
        state.hp -= dmg < state.hp ? dmg : state.hp;
      }
      playerCooldowns[p] = mainSpeed;
      someoneAttacked = true;
    }

    if (!someoneAttacked) {
      // Inlined advance(1): saves two closure allocations per kill and an
      // indirect call on every idle tick.
      ticks++;
      for (let p = 0; p < teamSize; p++) {
        if (playerCooldowns[p] > 0) playerCooldowns[p]--;
      }
      if (energy.energy < maxEnergy && --energy.regenCounter <= 0) {
        const next = energy.energy + regenAmount;
        energy.energy = next < maxEnergy ? next : maxEnergy;
        energy.regenCounter = regenPeriod;
      }
    }
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
  plans: EncounterPlan[],
  conf: EnergyConf,
  opts: SimOptions,
  rng: () => number,
): TripOutcome => {
  const loops = Math.max(1, opts.kills); // opts.kills now represents loops per trip
  const teamSize = conf.teamSize;
  const energy: EnergyState = {
    energy: opts.startEnergy * teamSize,
    regenCounter: opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS,
  };

  let combatTicks = 0;
  let totalTicks = 0;
  let energySpent = 0;
  let casts = 0;
  const killTicks: number[] = [];
  const encTicks = plans.map(() => 0);
  const encEnergy = plans.map(() => 0);
  const encCasts = plans.map(() => 0);

  const idle = makeAdvance(opts, energy, () => { totalTicks++; });

  for (let loop = 0; loop < loops; loop++) {
    for (let eIdx = 0; eIdx < plans.length; eIdx++) {
      const plan = plans[eIdx];
      const isLastEncounterInTrip = (loop === loops - 1) && (eIdx === plans.length - 1);

      // Downtime BEFORE this encounter starts
      if (plan.downtimeTicks > 0) {
        idle(plan.downtimeTicks);
      }

      let eT = 0;
      for (let k = 0; k < plan.count; k++) {
        const isLastKill = isLastEncounterInTrip && (k === plan.count - 1);
        const r = simulateKill(plan, conf, rng, energy, isLastKill);
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
    energy.energy = 100 * teamSize;
    energy.regenCounter = opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS;
  }

  return { combatTicks, totalTicks, energySpent, casts, killTicks, encTicks, encEnergy, encCasts };
};

const percentile = (sorted: ArrayLike<number>, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

/**
 * Sorted copy of a sample. A Float64Array sorts numerically without a
 * comparator callback, which is several times faster than `[...xs].sort((a,b)=>a-b)`
 * on the 5k-plus samples every result needs.
 */
const sortedCopy = (xs: number[]): Float64Array => Float64Array.from(xs).sort();

const mean = (xs: ArrayLike<number>): number => {
  if (!xs.length) return 0;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += xs[i];
  return sum / xs.length;
};

/**
 * Everything about the distribution's shape, from an already-sorted sample.
 * Cheap enough to compute for every plan, and the only way the distribution
 * popup can say anything about consistency rather than just the average.
 */
const describe = (sorted: ArrayLike<number>): import('./types').DistStats => {
  const n = sorted.length;
  if (!n) {
    return {
      samples: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0,
      p5: 0, p10: 0, p25: 0, p75: 0, p90: 0, p95: 0, p99: 0,
    };
  }
  const m = mean(sorted);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = sorted[i] - m;
    sq += d * d;
  }
  return {
    samples: n,
    mean: m,
    median: percentile(sorted, 0.5),
    stdDev: Math.sqrt(sq / n),
    min: sorted[0],
    max: sorted[n - 1],
    p5: percentile(sorted, 0.05),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
};

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

export type RawResult = Omit<SpecResult, 'secondsSaved' | 'secondsPer100Energy' | 'tripSecondsSaved'>;

/** Run the full Monte Carlo for one spec option (or the no-spec baseline). */
export const runSim = (input: SimInput): RawResult => {
  const { opts, plan, encounters } = input;
  const rng = mulberry32(opts.seed);
  const loops = Math.max(1, opts.kills);
  
  /**
   * With a drain the plan is "drain first, then spend the rest on damage", so
   * the drain is the primary and the damage spec the follow-up. With no drain
   * the damage spec is simply the primary, cast greedily.
   */
  const primaryId = plan.drainId ?? plan.dpsId;
  const followUpId = plan.drainId ? plan.dpsId : null;
  const primaryDef = primaryId ? specById(primaryId) : null;
  const followUpDef = followUpId ? specById(followUpId) : null;
  const teamSize = opts.teamSize ?? 1;

  // The committed cast count only tightens what the game already allows.
  const hardCap = primaryDef?.maxCasts ?? Infinity;
  const committed = plan.drainId && typeof plan.drainCasts === 'number' ? plan.drainCasts : Infinity;
  const primaryMaxCasts = Math.min(hardCap, committed);
  const primaryStopOnHit = primaryDef?.stopOnHit === true
    || (plan.drainId !== null && plan.drainCasts === 'untilHit');

  const conf: EnergyConf = {
    teamSize,
    maxEnergy: 100 * teamSize,
    regenAmount: 10 * teamSize,
    regenPeriod: opts.lightbearer ? REGEN_TICKS / 2 : REGEN_TICKS,
  };

  // Resolved once here, then reused (and mutated in place) by every one of the
  // hundreds of thousands of kills this run simulates.
  // Scaled by team size because every player specs out of the one shared pool.
  const holdUntil = plan.hold ? comboCost(plan) * teamSize : 0;

  const encPlans = encounters.map((enc) => {
    const primaryLoad = primaryId ? enc.specLoads[primaryId] : null;
    const followUpLoad = followUpId ? enc.specLoads[followUpId] : null;
    return makePlan(
      enc,
      primaryDef && primaryLoad
        ? { def: primaryDef, load: primaryLoad, maxCasts: primaryMaxCasts, stopOnHit: primaryStopOnHit }
        : null,
      followUpDef && followUpLoad
        ? { def: followUpDef, load: followUpLoad, maxCasts: Infinity, stopOnHit: false }
        : null,
      opts,
      rng,
      teamSize,
      holdUntil,
    );
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
    const r = simulateTrip(encPlans, conf, opts, rng);
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

  const sorted = sortedCopy(allKillTicks);
  const meanTicks = mean(allKillTicks);
  const meanTripTicks = totalTripTicks / trips;

  const breakdown = encounters.map((enc, eIdx) => {
    const sortedE = sortedCopy(allEncTicks[eIdx]);
    const meanE = mean(sortedE);
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
      stats: describe(sortedE),
      // secondsSaved will be filled in by compareSpecs
      secondsSaved: 0,
      tripSecondsSaved: 0,
      secondsPer100Energy: 0,
    };
  });

  return {
    planId: plan.id,
    planName: planLabel(plan),
    drainId: plan.drainId,
    dpsId: plan.dpsId,
    meanTicks,
    medianTicks: percentile(sorted, 0.5),
    p90Ticks: percentile(sorted, 0.9),
    meanSeconds: meanTicks * 0.6,
    tripSeconds: meanTripTicks * 0.6,
    energyUsed: totalKillsPerTrip > 0 ? (totalEnergy / trips / totalKillsPerTrip) : 0,
    meanSpecCasts: totalCasts / trips,
    hist: histogram(allKillTicks),
    stats: describe(sorted),
    breakdown,
  };
};

/**
 * Turn raw per-spec runs into the comparison table, best-first by time saved.
 *
 * Kept separate from the runs themselves so the runs can be split across a
 * pool of workers: every `runSim` reseeds from `opts.seed`, so a spec's numbers
 * do not depend on which worker computed it or in what order.
 */
export const finalizeResults = (baseline: RawResult, rawRows: RawResult[]): SpecResult[] => {
  const rows: SpecResult[] = rawRows.map((r) => {
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

/**
 * Compare every candidate plan against the no-spec baseline, single-threaded.
 * The app splits this across a worker pool instead; this is the reference path
 * used by tests and the offline scripts.
 */
export const comparePlans = (
  encounters: import('./types').SimEncounter[],
  plans: SpecPlan[],
  opts: SimOptions,
): SpecResult[] => finalizeResults(
  runSim({ encounters, plan: BASELINE_PLAN, opts }),
  plans.map((plan) => runSim({ encounters, plan, opts })),
);





