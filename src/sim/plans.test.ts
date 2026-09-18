import { describe, expect, it } from 'vitest';
import { SPECS, specById } from './specs';
import { castOptions, comboCost, enumeratePlans, planLabel } from './plans';

const all = new Set(SPECS.map((s) => s.id));

describe('plan search space', () => {
  it('bounds drain casts by what the opening energy pool affords', () => {
    const dwh = specById('dwh')!; // 50% a cast
    expect(castOptions(dwh, 1, 100)).toEqual([1, 2, 'untilHit']);
    // Half energy solo only pays for one; a team pools four bars.
    expect(castOptions(dwh, 1, 50)).toEqual([1, 'untilHit']);
    expect(castOptions(dwh, 4, 100)).toEqual([1, 2, 3, 4, 'untilHit']);
  });

  it('never offers the bone dagger more than its single use per target', () => {
    const bone = specById('bone_dagger')!;
    expect(bone.maxCasts).toBe(1);
    // One cast, and no "until one lands" - it only ever gets the one attempt.
    expect(castOptions(bone, 4, 100)).toEqual([1]);
  });

  it('pairs every drain and cast count with every damage spec', () => {
    const plans = enumeratePlans({ enabled: all, teamSize: 1, startEnergy: 100, killsPerTrip: 1 });
    const ids = new Set(plans.map((p) => p.id));

    expect(ids.has('dwh:2+voidwaker')).toBe(true);
    expect(ids.has('dwh:untilHit+voidwaker')).toBe(true);
    expect(ids.has('-:-+voidwaker')).toBe(true);  // damage spec on its own
    expect(ids.has('dwh:1+-')).toBe(true);        // drain on its own
    expect(ids.has('baseline')).toBe(false);      // run separately
  });

  it('only offers banked plans when a later kill could spend the savings', () => {
    const single = enumeratePlans({ enabled: all, teamSize: 1, startEnergy: 100, killsPerTrip: 1 });
    expect(single.some((p) => p.hold)).toBe(false);

    const trip = enumeratePlans({ enabled: all, teamSize: 1, startEnergy: 100, killsPerTrip: 10 });
    expect(trip.some((p) => p.hold)).toBe(true);
    // Banking is meaningless without two halves to save up for.
    expect(trip.filter((p) => p.hold).every((p) => p.drainId && p.dpsId)).toBe(true);
  });

  it('prices a banked combo at every committed drain cast plus one damage cast', () => {
    const plan = { id: 'x', drainId: 'dwh', drainCasts: 2 as const, dpsId: 'voidwaker', hold: true };
    expect(comboCost(plan)).toBe(50 * 2 + 50);
    // "Until one lands" has no fixed length, so it commits to a single cast.
    expect(comboCost({ ...plan, drainCasts: 'untilHit' })).toBe(50 + 50);
    // Nothing to combine, nothing to save for.
    expect(comboCost({ ...plan, dpsId: null })).toBe(0);
  });

  it('labels a plan by what it actually does', () => {
    const p = (o: object) => planLabel({ id: '', drainId: null, drainCasts: null, dpsId: null, ...o });
    expect(p({ drainId: 'dwh', drainCasts: 2 })).toBe('Dragon warhammer \u00d72');
    expect(p({ drainId: 'dwh', drainCasts: 'untilHit' })).toBe('Dragon warhammer (until 1 lands)');
    expect(p({ drainId: 'dwh', drainCasts: 1, dpsId: 'voidwaker' })).toBe('Dragon warhammer \u00d71 + Voidwaker');
    expect(p({ drainId: 'dwh', drainCasts: 1, dpsId: 'voidwaker', hold: true }))
      .toBe('Dragon warhammer \u00d71 + Voidwaker (banked)');
    expect(p({})).toBe('No spec (baseline)');
  });
});
