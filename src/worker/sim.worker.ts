import { compareSpecs } from '../sim/simulate';
import type { SimOptions, SpecResult } from '../sim/types';

/**
 * Runs the Monte Carlo off the main thread so a 50k-trial comparison never
 * freezes the UI.
 *
 * SpecDefs contain functions and cannot be structured-cloned, so the main
 * thread sends spec ids and the worker rehydrates them from the registry.
 *
 * Several variants can be sent in one message - the Lightbearer comparison
 * needs two full runs, and pairing them here keeps their results consistent.
 */

export interface SimVariant {
  key: string;
  encounters: import('../sim/types').SimEncounter[];
  specIds: string[];
  opts: SimOptions;
}

export interface SimRequest {
  id: number;
  variants: SimVariant[];
}

export type SimResponse =
  | { id: number; ok: true; results: Record<string, SpecResult[]> }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const { id, variants } = ev.data;
  try {
    const results: Record<string, SpecResult[]> = {};
    for (const variant of variants) {
      results[variant.key] = compareSpecs(variant.encounters, variant.specIds, variant.opts);
    }
    const res: SimResponse = { id, ok: true, results };
    self.postMessage(res);
  } catch (err) {
    const res: SimResponse = { id, ok: false, error: String(err) };
    self.postMessage(res);
  }
};
