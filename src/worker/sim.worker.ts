import { compareSpecs, type SpecWeapon } from '../sim/simulate';
import { specById } from '../sim/specs';
import type { Loadout, Monster, SimOptions, SpecResult } from '../sim/types';

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
  main: Loadout;
  specs: { id: string; load: Loadout }[];
  opts: SimOptions;
}

export interface SimRequest {
  id: number;
  monster: Monster;
  variants: SimVariant[];
}

export type SimResponse =
  | { id: number; ok: true; results: Record<string, SpecResult[]> }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const { id, monster, variants } = ev.data;
  try {
    const results: Record<string, SpecResult[]> = {};
    for (const variant of variants) {
      const candidates: SpecWeapon[] = variant.specs.flatMap((s) => {
        const def = specById(s.id);
        return def ? [{ def, load: s.load }] : [];
      });
      results[variant.key] = compareSpecs(monster, variant.main, candidates, variant.opts);
    }
    const res: SimResponse = { id, ok: true, results };
    self.postMessage(res);
  } catch (err) {
    const res: SimResponse = { id, ok: false, error: String(err) };
    self.postMessage(res);
  }
};
