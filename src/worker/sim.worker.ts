import { runSim, type RawResult } from '../sim/simulate';
import type { SpecPlan } from '../sim/plans';
import type { SimOptions, SimEncounter } from '../sim/types';

/**
 * Runs the Monte Carlo off the main thread so a 50k-trial comparison never
 * freezes the UI.
 *
 * SpecDefs contain functions and cannot be structured-cloned, so the main
 * thread sends plans (spec ids plus a committed cast count) and the worker
 * rehydrates the defs from the registry.
 *
 * A search is hundreds of independent runs, so the pool in `ui/simPool.ts`
 * hands them out a few at a time across as many workers as the machine has
 * cores. Every run reseeds from `opts.seed`, so splitting them changes nothing
 * about the numbers - and it means two plans are compared on the same rolls.
 *
 * The encounters and options are sent once per request as a `setup`, then each
 * `job` only names the plans to run: the per-job messages stay tiny and the
 * loadout payload is structured-cloned once per worker rather than once per plan.
 */

export interface SimSetupVariant {
  key: string;
  encounters: SimEncounter[];
  opts: SimOptions;
}

export type SimRequest =
  /** Install the payload for request `id`, replacing anything older. */
  | { type: 'setup'; id: number; variants: SimSetupVariant[] }
  /** Run these plans against variant `key`, at `trials` trials each. */
  | { type: 'job'; id: number; key: string; plans: SpecPlan[]; trials: number };

export type SimResponse =
  | { type: 'done'; id: number; ok: true; key: string; trials: number; results: RawResult[] }
  | { type: 'done'; id: number; ok: false; error: string };

/** Payload for the newest request this worker has been told about. */
let current: { id: number; variants: Map<string, SimSetupVariant> } | null = null;

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const msg = ev.data;

  if (msg.type === 'setup') {
    current = { id: msg.id, variants: new Map(msg.variants.map((v) => [v.key, v])) };
    return;
  }

  // A job for a superseded request: its setup is gone, and the pool is
  // ignoring the answer anyway.
  if (!current || current.id !== msg.id) return;

  try {
    const variant = current.variants.get(msg.key);
    if (!variant) throw new Error(`unknown variant: ${msg.key}`);
    const opts = { ...variant.opts, trials: msg.trials };
    const results = msg.plans.map((plan) => runSim({ encounters: variant.encounters, plan, opts }));
    self.postMessage({
      type: 'done', id: msg.id, ok: true, key: msg.key, trials: msg.trials, results,
    } satisfies SimResponse);
  } catch (err) {
    self.postMessage({ type: 'done', id: msg.id, ok: false, error: String(err) } satisfies SimResponse);
  }
};
