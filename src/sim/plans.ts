import { SPECS, specById, type SpecDef } from './specs';

/**
 * Spec *plans*: what you actually commit to at the start of a kill.
 *
 * A spec is never used in isolation. The real decision is "how many times do I
 * commit to the drain before I give up and start spending energy on damage",
 * and those two halves compete for one energy pool: at 100% energy a 50%-cost
 * drain buys you two casts per player and nothing else, so a second drain is
 * paid for by giving up a Voidwaker hit. Which side wins depends on how long
 * the fight is, because that decides how much energy regenerates back.
 *
 * None of that is separable, so a plan is the unit that gets simulated and
 * ranked - not a single spec.
 */

/** Committed number of drain casts, or "keep going until one lands". */
export type DrainCasts = number | 'untilHit';

export interface SpecPlan {
  /** Stable identity, used as a table key and to pair Lightbearer rows. */
  id: string;
  /** Defence-drain opener, if any. */
  drainId: string | null;
  /** How many drain casts to commit to. Null when there is no drain. */
  drainCasts: DrainCasts | null;
  /** Spec to spend the remaining energy on, if any. */
  dpsId: string | null;
  /**
   * Bank energy rather than dribble it away: only open on a kill you can
   * afford the whole combo on, otherwise fight it with the main weapon and
   * carry the energy forward.
   *
   * On a long trip this is a real choice. Spending whatever you have on every
   * kill means many kills get the cheap half of the combo and none get both;
   * holding means fewer kills are specced but the ones that are get the full
   * effect. Which wins depends on the fight length and the regen rate, so the
   * search tries both.
   */
  hold?: boolean;
}

export const BASELINE_PLAN: SpecPlan = {
  id: 'baseline',
  drainId: null,
  drainCasts: null,
  dpsId: null,
};

export const planId = (
  drainId: string | null,
  casts: DrainCasts | null,
  dpsId: string | null,
  hold = false,
): string => (drainId || dpsId
  ? `${drainId ?? '-'}:${casts ?? '-'}+${dpsId ?? '-'}${hold ? '!hold' : ''}`
  : BASELINE_PLAN.id);

/**
 * Committing to more than this many drain casts is never the answer: each cast
 * strips a share of *current* Defence, so the fourth is worth a fraction of the
 * first, and most targets hit their Defence floor well before then.
 */
const MAX_DRAIN_CASTS = 4;

/**
 * Cast counts worth considering for one drain.
 *
 * The opening energy pool is the real constraint the player feels - it is what
 * makes the second warhammer cast cost you a Voidwaker - so it sets the range.
 * A spec with a hard in-game limit (the bone dagger only works once per target)
 * never offers more than that, and has no "until one lands" option because it
 * only ever gets the one attempt.
 */
export const castOptions = (def: SpecDef, teamSize: number, startEnergy: number): DrainCasts[] => {
  const hardCap = def.maxCasts ?? Infinity;
  const affordable = Math.floor((startEnergy * teamSize) / def.cost);
  const ceiling = Math.min(hardCap, MAX_DRAIN_CASTS, Math.max(1, affordable));

  const out: DrainCasts[] = [];
  for (let n = 1; n <= ceiling; n++) out.push(n);
  if (hardCap > 1) out.push('untilHit');
  return out;
};

export interface PlanSearch {
  /** Spec ids the user left enabled. */
  enabled: ReadonlySet<string>;
  teamSize: number;
  startEnergy: number;
  /** Kills in one trip. Banking energy is only a choice when there is a next kill. */
  killsPerTrip: number;
}

/**
 * Every plan worth simulating: each drain (at each committed cast count)
 * against each damage spec, plus each on its own. The baseline is not included
 * - it is run separately as the thing everything else is measured against.
 */
export const enumeratePlans = (
  { enabled, teamSize, startEnergy, killsPerTrip }: PlanSearch,
): SpecPlan[] => {
  const drains = SPECS.filter((s) => s.drains && enabled.has(s.id));
  const damage = SPECS.filter((s) => !s.drains && enabled.has(s.id));

  const openers: { id: string | null; casts: DrainCasts | null }[] = [{ id: null, casts: null }];
  for (const d of drains) {
    for (const casts of castOptions(d, teamSize, startEnergy)) openers.push({ id: d.id, casts });
  }

  const finishers: (string | null)[] = [null, ...damage.map((s) => s.id)];

  // Banking only means anything when a later kill can spend what you saved,
  // and only when the plan has two halves to save up for.
  const canBank = killsPerTrip > 1;

  const out: SpecPlan[] = [];
  for (const opener of openers) {
    for (const dpsId of finishers) {
      if (!opener.id && !dpsId) continue; // that pairing is the baseline
      out.push({
        id: planId(opener.id, opener.casts, dpsId),
        drainId: opener.id,
        drainCasts: opener.casts,
        dpsId,
      });
      if (canBank && opener.id && dpsId) {
        out.push({
          id: planId(opener.id, opener.casts, dpsId, true),
          drainId: opener.id,
          drainCasts: opener.casts,
          dpsId,
          hold: true,
        });
      }
    }
  }
  return out;
};

/**
 * Energy one player needs before a `hold` plan will open on a kill: every
 * committed drain cast plus one cast of the damage spec. "Until one lands" has
 * no fixed length, so it commits to a single cast's worth.
 */
export const comboCost = (plan: SpecPlan): number => {
  const drain = plan.drainId ? specById(plan.drainId) : null;
  const dps = plan.dpsId ? specById(plan.dpsId) : null;
  if (!drain || !dps) return 0;
  const casts = typeof plan.drainCasts === 'number' ? plan.drainCasts : 1;
  return drain.cost * casts + dps.cost;
};

/** Human label for a plan, e.g. "Dragon warhammer x2 + Voidwaker". */
export const planLabel = (plan: SpecPlan): string => {
  const drain = plan.drainId ? specById(plan.drainId) : null;
  const dps = plan.dpsId ? specById(plan.dpsId) : null;

  const parts: string[] = [];
  if (drain) {
    parts.push(
      plan.drainCasts === 'untilHit'
        ? `${drain.name} (until 1 lands)`
        : `${drain.name} ×${plan.drainCasts}`,
    );
  }
  if (dps) parts.push(dps.name);
  if (!parts.length) return 'No spec (baseline)';
  return parts.join(' + ') + (plan.hold ? ' (banked)' : '');
};
