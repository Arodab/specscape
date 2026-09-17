/**
 * Scratch harness: prints the spec comparison table for a few real encounters.
 * Run with: npx vite-node scripts/scenario.ts
 */
import { buildLoadout, PRAYERS, STYLES, type Factor } from '../src/sim/loadout';
import { SPECS } from '../src/sim/specs';
import { compareSpecs, type SpecWeapon } from '../src/sim/simulate';
import type { DefStyle, Monster } from '../src/sim/types';
import monstersData from '../public/data/monsters.json';
import equipmentData from '../public/data/equipment.json';

interface Equip {
  id: number; name: string; slot: string; speed: number | null; version: string | null;
  o: {
    stab: number; slash: number; crush: number; magic: number; ranged: number;
    str: number; ranged_str: number; magic_str: number;
  };
}

const monsters = monstersData as unknown as Monster[];
const equipment = equipmentData as unknown as Equip[];

const item = (name: string): Equip => {
  const matches = equipment.filter((e) => e.name === name && e.slot === 'weapon');
  if (!matches.length) throw new Error(`item not found: ${name}`);
  return matches.find((m) => !m.version || /charged|regular/i.test(m.version)) ?? matches[0];
};

const monster = (name: string): Monster => {
  const matches = monsters.filter((m) => m.name === name);
  if (!matches.length) throw new Error(`monster not found: ${name}`);
  return matches[0];
};

const LEVELS = { attack: 99, strength: 99, ranged: 99, magic: 99 };
const BOOSTS = { attack: 19, strength: 19, ranged: 19, magic: 0 };

/** Torva-tier non-weapon gear. */
const ARMOUR = { attack: 60, strength: 80, ranged: 40, rangedStr: 30 };

const load = (
  name: string, weapon: Equip, style: DefStyle, speed: number,
  type: 'melee' | 'ranged', factors: Factor[] = [],
) =>
  buildLoadout({
    name, type, levels: LEVELS, boosts: BOOSTS,
    prayers: type === 'ranged' ? PRAYERS.rigour : PRAYERS.piety,
    style: STYLES.accurate,
    equip:
      type === 'ranged'
        ? {
            attack: ARMOUR.ranged + weapon.o.ranged,
            strength: ARMOUR.rangedStr + weapon.o.ranged_str,
          }
        : {
            attack: ARMOUR.attack + (weapon.o[style as 'stab' | 'slash' | 'crush'] ?? 0),
            strength: ARMOUR.strength + weapon.o.str,
          },
    speed,
    defStyle: style,
    attackFactors: factors,
    damageFactors: factors,
  });

const specWeapons = (factors: Factor[]): SpecWeapon[] =>
  SPECS.flatMap((def) => {
    let weapon: Equip;
    try { weapon = item(def.item); } catch { return []; }
    const style = def.defStyle === 'magic' && def.type === 'melee' ? 'slash' : def.defStyle;
    const type = def.type === 'magic' ? 'melee' : def.type;
    return [{ def, load: load(def.name, weapon, style as DefStyle, def.speed, type, factors) }];
  });

const pad = (s: string, n: number) => s.padEnd(n);
const num = (v: number, n = 2) => v.toFixed(n).padStart(8);

interface RunOpts { kills?: number; downtime?: number; salve?: boolean; label?: string }

const run = (monsterName: string, mainName: string, o: RunOpts = {}) => {
  const m = monster(monsterName);
  const kills = o.kills ?? 1;
  const factors: Factor[] = o.salve ? [[6, 5]] : [];
  const weapon = item(mainName);
  const main = load(mainName, weapon, 'stab', weapon.speed ?? 4, 'melee', factors);

  const rows = compareSpecs(m, main, specWeapons(factors), {
    startEnergy: 100, lightbearer: false, trials: 8000, seed: 12345,
    kills, downtimeTicks: o.downtime ?? 0,
  });

  console.log(`\n=== ${m.name} - ${m.hp} HP, ${m.def} def${o.label ? ` [${o.label}]` : ''} ===`);
  console.log(`main: ${main.name} maxHit=${main.maxHit} | kills=${kills} downtime=${o.downtime ?? 0}t`);
  console.log(
    `${pad('spec', 22)}${pad('kill(s)', 10)}${pad('saved(s)', 10)}${pad('trip(s)', 10)}${pad('energy', 9)}casts`,
  );
  for (const r of rows.slice(0, 9)) {
    console.log(
      `${pad(r.specName, 22)}${num(r.meanSeconds)}  ${num(r.secondsSaved)}  ${num(r.tripSecondsSaved, 0)}  ${num(r.energyUsed, 0)} ${num(r.meanSpecCasts, 2)}`,
    );
  }
};

run('Vorkath', 'Ghrazi rapier', { label: 'single kill' });
run('Vorkath', 'Ghrazi rapier', { salve: true, label: 'single kill + salve (ei)' });
run('Abyssal demon', 'Ghrazi rapier', { kills: 20, downtime: 30, label: 'slayer trip' });
run('General Graardor', 'Ghrazi rapier', { kills: 10, downtime: 100, label: 'bandos trip' });
