import { finalizeResults, type RawResult } from '../sim/simulate';
import { BASELINE_PLAN, type SpecPlan } from '../sim/plans';
import type { SpecResult } from '../sim/types';
import type { SimSetupVariant, SimRequest, SimResponse } from '../worker/sim.worker';

/**
 * A pool of simulation workers, running a two-stage plan search.
 *
 * Every plan is an independent Monte Carlo run reseeded from the same
 * `opts.seed`, so they parallelise perfectly and - because they share random
 * numbers - are directly comparable.
 *
 * The search space is the problem. Every drain, at every committed cast count,
 * against every damage spec is several hundred plans; at full trials that is
 * seconds of work for a table where all but the top dozen rows are noise. So:
 *
 *   stage 1  every plan at a fraction of the trials, purely to rank them
 *   stage 2  the survivors re-run at full trials, and those are the numbers
 *            actually shown
 *
 * Shared random numbers are what makes the cheap stage trustworthy: two plans
 * are measured against the same rolls, so their *difference* is far less noisy
 * than either estimate on its own, which is exactly what ranking needs.
 *
 * Work is pulled, not pre-assigned. Plans differ wildly in cost - one that ends
 * the kill early is far cheaper than the baseline - so fixed chunks would leave
 * most cores idle waiting on whichever chunk drew the expensive runs.
 *
 * Only the newest request matters: when the user drags a slider we want the
 * latest numbers, not a queue of stale ones, so every dispatch bumps a request
 * id and results carrying an older id are dropped.
 */

/** One variant of a comparison: the normal run, or the Lightbearer run. */
export interface SimVariant {
  key: string;
  encounters: SimSetupVariant['encounters'];
  plans: SpecPlan[];
  opts: SimSetupVariant['opts'];
}

export interface SimProgress {
  /** 'search' while ranking every plan, 'refine' while re-running the survivors. */
  stage: 'search' | 'refine';
  done: number;
  total: number;
}

type Done = (results: Record<string, SpecResult[]>) => void;
type Fail = (error: string) => void;
type OnProgress = (p: SimProgress) => void;

/** Plans per job. Small enough to balance, large enough to amortise messaging. */
const JOB_SIZE = 4;

/**
 * How many plans survive the cheap ranking stage, per variant.
 *
 * At least as many as the table will show, plus headroom so the cheap ranking
 * has room to be slightly wrong about the order without dropping a real
 * contender. scripts/check-search.ts checks this against an exhaustive
 * full-trial run: change it and re-run that.
 */
const refineTop = (shown: number): number => Math.max(14, shown + 4);

/**
 * Below this many plans the cheap stage is not worth its own overhead - just
 * run everything properly.
 */
const SEARCH_THRESHOLD = 40;

/** Leave a core for the UI thread. */
const poolSize = (): number => {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(12, cores - 1));
};

const coarseTrials = (full: number): number => Math.max(200, Math.min(600, Math.round(full / 16)));

interface Job { key: string; plans: SpecPlan[]; trials: number }

interface PendingRun {
  id: number;
  stage: 'search' | 'refine';
  variants: SimVariant[];
  fullTrials: number;
  refineTop: number;
  queue: Job[];
  outstanding: number;
  /** Results collected during the current stage, keyed by variant. */
  raw: Record<string, RawResult[]>;
  totalJobs: number;
  doneJobs: number;
  done: Done;
  fail: Fail;
  onProgress?: OnProgress;
}

const chunk = (key: string, plans: SpecPlan[], trials: number): Job[] => {
  const out: Job[] = [];
  for (let i = 0; i < plans.length; i += JOB_SIZE) {
    out.push({ key, plans: plans.slice(i, i + JOB_SIZE), trials });
  }
  return out;
};

export class SimPool {
  private workers: Worker[] = [];
  private reqId = 0;
  private pending: PendingRun | null = null;

  private ensureWorkers(n: number): void {
    while (this.workers.length < n) {
      const w = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<SimResponse>) => this.onResult(w, ev.data);
      this.workers.push(w);
    }
  }

  /** Give a worker the next job, if there is one. */
  private feed(w: Worker, job: PendingRun): boolean {
    const next = job.queue.pop();
    if (!next) return false;
    job.outstanding++;
    w.postMessage({
      type: 'job', id: job.id, key: next.key, plans: next.plans, trials: next.trials,
    } satisfies SimRequest);
    return true;
  }

  private fill(job: PendingRun): void {
    for (const w of this.workers) {
      if (!this.feed(w, job)) break;
    }
  }

  private onResult(w: Worker, res: SimResponse): void {
    const job = this.pending;
    if (!job || res.id !== job.id) return; // superseded by a newer request

    job.outstanding--;

    if (!res.ok) {
      this.pending = null;
      job.fail(res.error);
      return;
    }

    (job.raw[res.key] ??= []).push(...res.results);
    job.doneJobs++;
    job.onProgress?.({ stage: job.stage, done: job.doneJobs, total: job.totalJobs });

    if (this.feed(w, job)) return;
    if (job.outstanding > 0) return;

    if (job.stage === 'search') this.startRefine(job);
    else this.finish(job);
  }

  /**
   * Rank the cheap results and re-run the survivors properly.
   *
   * The survivors are the union of every variant's top plans, not each
   * variant's own: the Lightbearer columns sit on the same rows as the normal
   * ones, so both have to have run the same set of plans or half the table
   * would have nothing to show in them.
   */
  private startRefine(job: PendingRun): void {
    const keep = new Set<string>();
    for (const v of job.variants) {
      const rows = (job.raw[v.key] ?? []).filter((r) => r.planId !== BASELINE_PLAN.id);
      const base = (job.raw[v.key] ?? []).find((r) => r.planId === BASELINE_PLAN.id);
      const baseSeconds = base?.meanSeconds ?? Infinity;
      for (const r of [...rows].sort((a, b) => a.meanSeconds - b.meanSeconds).slice(0, job.refineTop)) {
        if (r.meanSeconds <= baseSeconds) keep.add(r.planId);
      }
    }

    const survivors = job.variants[0].plans.filter((p) => keep.has(p.id));
    if (!survivors.length) {
      // Nothing beat doing nothing. Show the baseline alone rather than a
      // table of plans that all lose.
      this.finishWithBaselineOnly(job);
      return;
    }

    job.stage = 'refine';
    job.raw = {};
    job.queue = job.variants.flatMap((v) =>
      chunk(v.key, [BASELINE_PLAN, ...survivors], job.fullTrials),
    );
    job.totalJobs = job.queue.length;
    job.doneJobs = 0;
    job.onProgress?.({ stage: 'refine', done: 0, total: job.totalJobs });
    this.fill(job);
  }

  private finishWithBaselineOnly(job: PendingRun): void {
    this.pending = null;
    const out: Record<string, SpecResult[]> = {};
    for (const v of job.variants) {
      const base = (job.raw[v.key] ?? []).find((r) => r.planId === BASELINE_PLAN.id);
      if (base) out[v.key] = finalizeResults(base, []);
    }
    job.done(out);
  }

  private finish(job: PendingRun): void {
    this.pending = null;
    const out: Record<string, SpecResult[]> = {};
    for (const v of job.variants) {
      const rows = job.raw[v.key] ?? [];
      const baseline = rows.find((r) => r.planId === BASELINE_PLAN.id);
      if (!baseline) continue;

      /**
       * Results come back in whatever order the workers finished, but the table
       * is sorted by time saved with a stable sort - so without this, plans that
       * tie would swap places between two runs of identical inputs. Restoring a
       * fixed order first makes the table reproducible.
       */
      const rank = new Map(v.plans.map((p, i) => [p.id, i]));
      const planRows = rows
        .filter((r) => r.planId !== BASELINE_PLAN.id)
        .sort((a, b) => (rank.get(a.planId) ?? 0) - (rank.get(b.planId) ?? 0));

      out[v.key] = finalizeResults(baseline, planRows);
    }
    job.done(out);
  }

  /**
   * Dispatch a comparison. Any run still in flight is abandoned - its results
   * are ignored when they arrive.
   */
  run(
    variants: SimVariant[],
    done: Done,
    fail: Fail,
    onProgress?: OnProgress,
    shown = 10,
  ): void {
    const id = ++this.reqId;

    if (!variants.length || !variants[0].plans.length) {
      done({});
      return;
    }

    const fullTrials = variants[0].opts.trials;
    const planCount = variants[0].plans.length;
    const top = refineTop(shown);
    const twoStage = planCount > Math.max(SEARCH_THRESHOLD, top);
    const stage: 'search' | 'refine' = twoStage ? 'search' : 'refine';
    const trials = twoStage ? coarseTrials(fullTrials) : fullTrials;

    const queue = variants.flatMap((v) => chunk(v.key, [BASELINE_PLAN, ...v.plans], trials));

    const n = Math.min(poolSize(), queue.length);
    this.ensureWorkers(n);

    const setup: SimRequest = {
      type: 'setup',
      id,
      variants: variants.map((v) => ({ key: v.key, encounters: v.encounters, opts: v.opts })),
    };
    for (const w of this.workers) w.postMessage(setup);

    this.pending = {
      id, stage, variants, fullTrials, refineTop: top, queue,
      outstanding: 0, raw: {}, totalJobs: queue.length, doneJobs: 0,
      done, fail, onProgress,
    };
    onProgress?.({ stage, done: 0, total: queue.length });
    this.fill(this.pending);
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending = null;
  }
}
