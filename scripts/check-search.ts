/**
 * Does the cheap ranking stage pick the same winners as an exhaustive run?
 *
 * The app ranks every plan at a fraction of the trials, keeps the top handful
 * and only then spends full trials on those. That is only sound if the cheap
 * ranking puts the real winners in the shortlist. This runs every plan at full
 * trials and checks that it does.
 *
 *   npx vite-node scripts/check-search.ts
 */
import { PRESETS, parseGearRef } from '../src/sim/presets';
import { SPECS } from '../src/sim/specs';
import { enumeratePlans } from '../src/sim/plans';
import { runSim } from '../src/sim/simulate';
import { buildMain, buildSpecCandidates, stylesFor, type SetupInput } from '../src/ui/build';
import { pickVariant, type Equip, type GearSet, type Slot } from '../src/sim/gear';
import { DEFAULT_BUFFS } from '../src/sim/modifiers';
import type { Monster, SimEncounter, Loadout } from '../src/sim/types';
import monstersData from '../public/data/monsters.json';
import equipmentData from '../public/data/equipment.json';

const monsters = monstersData as unknown as Monster[];
const equipment = equipmentData as unknown as Equip[];
const label = (m: Monster) => (m.version ? `${m.name} (${m.version})` : m.name);

const gearFor = (presetId: string): { gear: GearSet; prayerKey: string; styleIndex: number; potionId: string } => {
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const gear: GearSet = {};
  for (const [slot, ref] of Object.entries(preset.gear)) {
    if (!ref) continue;
    const { name, version } = parseGearRef(ref as string);
    const hit = pickVariant(equipment.filter((e) => e.name === name && (version === null || e.version === version)));
    if (hit) gear[slot as Slot] = hit;
  }
  const styles = stylesFor(gear);
  const idx = styles.findIndex((s) => s.name === preset.styleName);
  return {
    gear,
    prayerKey: preset.prayer,
    styleIndex: idx === -1 ? 0 : idx,
    potionId: preset.type === 'ranged' ? 'ranging' : preset.type === 'magic' ? 'imbued_heart' : 'super_combat',
  };
};

/** Mirrors simPool.ts. */
const DIV = Number(process.env.COARSE_DIV ?? 16);
const COARSE = (full: number) => Math.max(200, Math.min(600, Math.round(full / DIV)));
const REFINE_TOP = Number(process.env.REFINE_TOP ?? 14); // = refineTop(10) in simPool.ts

const scenarios: { monster: string; preset: string; teamSize: number; killsPerTrip: number }[] = [
  { monster: 'Vorkath (Post-quest)', preset: 'max_melee_scythe', teamSize: 1, killsPerTrip: 1 },
  { monster: 'General Graardor', preset: 'max_melee_scythe', teamSize: 1, killsPerTrip: 1 },
  { monster: 'Tekton (Normal)', preset: 'max_melee_scythe', teamSize: 1, killsPerTrip: 1 },
  { monster: 'Vorkath (Post-quest)', preset: 'max_melee_scythe', teamSize: 4, killsPerTrip: 1 },
  // Trips are where banking energy becomes a real option, so the search doubles.
  { monster: 'Vorkath (Post-quest)', preset: 'max_melee_scythe', teamSize: 1, killsPerTrip: 10 },
  { monster: 'Abyssal demon', preset: 'max_melee_scythe', teamSize: 1, killsPerTrip: 20 },
];

let bad = 0;

for (const sc of scenarios) {
  const m = monsters.find((x) => label(x) === sc.monster);
  if (!m) { console.log(`SKIP  ${sc.monster} (not in data)`); continue; }

  const g = gearFor(sc.preset);
  const setup: SetupInput = {
    gear: g.gear,
    levels: { attack: 99, strength: 99, ranged: 99, magic: 99 },
    potionId: g.potionId,
    prayerKey: g.prayerKey,
    styleIndex: g.styleIndex,
    spell: null,
    buffs: DEFAULT_BUFFS,
  };

  const enabled = new Set(SPECS.map((s) => s.id));
  const main = buildMain(setup, m);
  const specLoads: Record<string, Loadout> = {};
  for (const sp of buildSpecCandidates(setup, equipment, enabled, m, {})) specLoads[sp.id] = sp.load;
  const encounters: SimEncounter[] = [{ monster: m, main, specLoads, count: 1, downtimeTicks: 0 }];

  const startEnergy = 100;
  const trials = 5000;
  const plans = enumeratePlans({ enabled, teamSize: sc.teamSize, startEnergy, killsPerTrip: sc.killsPerTrip });
  const opts = {
    startEnergy, seed: 12345, kills: sc.killsPerTrip, downtimeTicks: 0, bankingTicks: 0,
    lightbearer: false, teamSize: sc.teamSize,
    specOptions: Object.fromEntries(SPECS.filter((s) => s.option).map((s) => [s.option!.key, s.option!.default])),
  };

  const byTime = (a: { meanSeconds: number }, b: { meanSeconds: number }) => a.meanSeconds - b.meanSeconds;

  // Truth: every plan at full trials.
  const full = plans.map((plan) => runSim({ encounters, plan, opts: { ...opts, trials } })).sort(byTime);

  // What the app does: rank cheap, then re-run the shortlist at full trials.
  const coarse = plans
    .map((plan) => ({ plan, r: runSim({ encounters, plan, opts: { ...opts, trials: COARSE(trials) } }) }))
    .sort((a, b) => byTime(a.r, b.r))
    .slice(0, REFINE_TOP);
  const refined = coarse
    .map(({ plan }) => runSim({ encounters, plan, opts: { ...opts, trials } }))
    .sort(byTime);

  const truthTop = full[0];
  const searchTop = refined[0];
  const gap = searchTop.meanSeconds - truthTop.meanSeconds;
  const shortlist = new Set(coarse.map((c) => c.plan.id));
  const truthTop5In = full.slice(0, 5).filter((r) => shortlist.has(r.planId)).length;

  const ok = gap < 0.35; // within a third of a second of the true best
  if (!ok) bad++;
  console.log(
    `${ok ? 'OK  ' : 'MISS'} ${sc.monster} team=${sc.teamSize} | ${plans.length} plans\n` +
    `       exhaustive best: ${truthTop.planName} (${truthTop.meanSeconds.toFixed(2)}s)\n` +
    `       search best:     ${searchTop.planName} (${searchTop.meanSeconds.toFixed(2)}s)  gap ${gap.toFixed(2)}s\n` +
    `       true top-5 kept by shortlist: ${truthTop5In}/5`,
  );
}

console.log(bad === 0 ? '\nsearch shortlist is sound' : `\n${bad} scenario(s) lost the best plan`);
