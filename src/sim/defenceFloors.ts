/**
 * Some bosses cannot have their Defence drained below a floor, and a couple
 * cannot be drained at all. This is the single biggest reason "just DWH it"
 * is wrong advice, so it gets surfaced in the UI.
 *
 * Values from the OSRS Wiki / DPS calculator's defence reduction rules.
 */

/** Monsters whose Defence cannot be reduced at all. */
const NO_DRAIN = [/^Verzik Vitur/i, /^Vardorvis/i];

const FLOORS: [RegExp, number][] = [
  [/^Nex/i, 250],
  [/^Yama/i, 145],
  [/^Sotetseg/i, 100],
  [/^The Nightmare|^Phosani/i, 120],
  [/^Tumeken's Warden|^Elidinis' Warden/i, 120],
  [/^The Hueycoatl/i, 120],
  [/^Araxxor|^Araxyte/i, 90],
  [/^Akkha/i, 70],
  [/^Ba-Ba/i, 60],
  [/^Kephri/i, 60],
  [/^Obelisk/i, 60],
  [/^Zebak/i, 50],
];

export interface DrainLimit {
  floor: number;
  /** True when the monster is immune to defence reduction entirely. */
  immune: boolean;
}

export const drainLimit = (name: string, currentDef: number): DrainLimit => {
  if (NO_DRAIN.some((re) => re.test(name))) {
    return { floor: currentDef, immune: true };
  }
  const match = FLOORS.find(([re]) => re.test(name));
  return { floor: match ? match[1] : 0, immune: false };
};
