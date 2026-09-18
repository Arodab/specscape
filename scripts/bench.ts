/**
 * Benchmark + golden-output harness for the first-load simulation.
 * Run with: npx vite-node scripts/bench.ts
 *   BENCH_MONSTER="Vorkath (Post-quest)"  pick the target
 *   BENCH_GEAR=empty                      simulate with no gear equipped
 *   BENCH_DUMP=1                          print a stable digest of every result
 */
import { PRESETS, parseGearRef } from '../src/sim/presets';
import { SPECS } from '../src/sim/specs';
import { comparePlans } from '../src/sim/simulate';
import { enumeratePlans } from '../src/sim/plans';
import { buildMain, buildSpecCandidates, stylesFor, type SetupInput } from '../src/ui/build';
import { pickVariant, type Equip, type GearSet, type Slot } from '../src/sim/gear';
import { DEFAULT_BUFFS } from '../src/sim/modifiers';
import type { Monster, SimEncounter, Loadout } from '../src/sim/types';
import monstersData from '../public/data/monsters.json';
import equipmentData from '../public/data/equipment.json';

const monsters = monstersData as unknown as Monster[];
const equipment = equipmentData as unknown as Equip[];

const monsterLabel = (m: Monster) => (m.version ? `${m.name} (${m.version})` : m.name);

const buildTabFromPreset = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const nextGear: GearSet = {};
  for (const [slot, ref] of Object.entries(preset.gear)) {
    if (!ref) continue;
    const { name, version } = parseGearRef(ref as string);
    const hit = pickVariant(equipment.filter((e) => e.name === name && (version === null || e.version === version)));
    if (hit) nextGear[slot as Slot] = hit;
  }
  const nextStyles = stylesFor(nextGear);
  const idx = nextStyles.findIndex((s) => s.name === preset.styleName);
  return {
    gear: nextGear,
    prayerKey: preset.prayer,
    styleIndex: idx === -1 ? 0 : idx,
    potionId: preset.type === 'ranged' ? 'ranging' : preset.type === 'magic' ? 'imbued_heart' : 'super_combat',
  };
};

const MONSTER = process.env.BENCH_MONSTER ?? 'Vorkath (Post-quest)';
const levels = { attack: 99, strength: 99, ranged: 99, magic: 99 };
const enabled = new Set(SPECS.map((s) => s.id));


const tab = buildTabFromPreset('max_melee_scythe');
const m = monsters.find((x) => monsterLabel(x) === MONSTER) ?? monsters[0];

const setupForTab: SetupInput = {
  gear: process.env.BENCH_GEAR === 'empty' ? {} : tab.gear,
  levels,
  potionId: tab.potionId,
  prayerKey: tab.prayerKey,
  styleIndex: tab.styleIndex,
  spell: null,
  buffs: DEFAULT_BUFFS,
};

const main = buildMain(setupForTab, m);
const specsList = buildSpecCandidates(setupForTab, equipment, enabled, m, {});
const specLoads: Record<string, Loadout> = {};
for (const sp of specsList) specLoads[sp.id] = sp.load;

const encounters: SimEncounter[] = [{ monster: m, main, specLoads, count: 1, downtimeTicks: 0 }];

const plans = enumeratePlans({ enabled, teamSize: Number(process.env.BENCH_TEAM ?? 1), startEnergy: 100, killsPerTrip: Number(process.env.BENCH_KILLS ?? 1) });
console.log(`plan search space: ${plans.length} plans (+ baseline)`);

const opts = {
  startEnergy: 100,
  trials: 5000,
  seed: 12345,
  kills: Number(process.env.BENCH_KILLS ?? 1),
  downtimeTicks: 0,
  bankingTicks: 50,
  specOptions: Object.fromEntries(SPECS.filter((s) => s.option).map((s) => [s.option!.key, s.option!.default])),
  teamSize: Number(process.env.BENCH_TEAM ?? 1),
};

if (process.env.BENCH_DUMP) {
  // Stable digest: exact numbers so an optimisation can be proven behaviour-preserving.
  for (const [label, lightbearer] of [['normal', false], ['lightbearer', true]] as const) {
    const rows = comparePlans(encounters, plans, { ...opts, lightbearer });
    for (const r of rows) {
      console.log(
        `${label}|${r.planId}|${r.meanTicks.toFixed(6)}|${r.medianTicks}|${r.p90Ticks}` +
        `|${r.energyUsed.toFixed(6)}|${r.meanSpecCasts.toFixed(6)}|${r.secondsSaved.toFixed(6)}` +
        `|${r.hist.map((h) => `${h.tick.toFixed(4)}:${h.count}`).join(',')}`,
      );
    }
  }
} else {
  console.log(`monster: ${monsterLabel(m)} hp=${m.hp} def=${m.def} | main=${main.name} maxHit=${main.maxHit}`);
  const best: number[] = [];
  for (let iter = 0; iter < 3; iter++) {
    const t = Date.now();
    for (const lightbearer of [false, true]) comparePlans(encounters, plans, { ...opts, lightbearer });
    best.push(Date.now() - t);
  }
  console.log(`full first-load workload (normal + lightbearer): ${Math.min(...best)}ms  [runs: ${best.join(', ')}]`);
}
