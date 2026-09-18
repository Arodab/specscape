export type DefStyle = 'stab' | 'slash' | 'crush' | 'magic' | 'standard' | 'light' | 'heavy';
export type AttackType = 'melee' | 'ranged' | 'magic';

export interface Monster {
  id: number;
  name: string;
  version: string | null;
  size: number;
  speed: number;
  hp: number;
  def: number;
  magic: number;
  d: Record<DefStyle, number>;
  flatArmour: number;
  attributes: string[];
  isSlayerMonster: boolean;
  /**
   * Doom of Mokhaiotl's melee punish window: crush attacks roll against 15% of
   * the usual defence roll.
   */
  meleePunish?: boolean;
}

/** Mutable per-kill monster state. Defence drains during a fight. */
export interface MonsterState {
  hp: number;
  def: number;
  magic: number;
  /** Levels at fight start - Arclight/Emberlight drain off the BASE level, not current. */
  baseDef: number;
  baseAtk: number;
  baseStr: number;
}

/**
 * A fully-resolved attacking setup. The UI reduces gear + buffs down to these
 * numbers so the sim never has to know about equipment.
 */
export interface Loadout {
  name: string;
  type: AttackType;
  /** Max attack roll (already includes prayer, potions, void, salve, slayer...). */
  attackRoll: number;
  maxHit: number;
  /** Weapon attack speed in ticks. */
  speed: number;
  /** Which monster defence bonus this attack rolls against. */
  defStyle: DefStyle;
  /** The ammo used (if any) */
  ammoName?: string | null;
}

export interface SimEncounter {
  monster: Monster;
  main: Loadout;
  specLoads: Record<string, Loadout>;
  count: number;
  downtimeTicks: number; // Converted from seconds
}

export interface SimOptions {
  /** Starting special attack energy, 0-100. */
  startEnergy: number;
  /** Lightbearer doubles spec regen. */
  lightbearer: boolean;
  /** Monte Carlo trials (each trial simulates a whole trip). */
  trials: number;
  seed: number;
  /** Kills per trip. 1 is single-kill mode. */
  kills: number;
  /** Ticks between kills - respawn, walking. Energy regenerates through it. */
  downtimeTicks: number;
  /**
   * Ticks spent banking at the end of a trip. The player is assumed to come back
   * with full special attack energy, so this is dead time rather than regen time.
   */
  bankingTicks: number;
  /** Number of identical players attacking the boss simultaneously. */
  teamSize?: number;
  /** Per-spec toggles, keyed by SpecDef.option.key. */
  specOptions: Record<string, boolean>;
}

/**
 * The shape of a simulated kill-time distribution, in ticks.
 *
 * The mean is what the table ranks on, but it hides everything that matters
 * about consistency: two plans can average the same and have completely
 * different tails, which is the difference between a reliable kill and one
 * that occasionally runs long.
 */
export interface DistStats {
  samples: number;
  mean: number;
  median: number;
  /** Population standard deviation. */
  stdDev: number;
  min: number;
  max: number;
  p5: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface SpecResult {
  /** Stable id of the plan this row simulated (see sim/plans.ts). */
  planId: string;
  /** Human label, e.g. "Dragon warhammer x2 + Voidwaker". */
  planName: string;
  /** The drain opener this plan used, for icons and switch overrides. */
  drainId: string | null;
  /** The damage spec this plan used, for icons and switch overrides. */
  dpsId: string | null;
  /** Mean ticks to kill. */
  meanTicks: number;
  medianTicks: number;
  p90Ticks: number;
  meanSeconds: number;
  /** Mean duration of a whole trip, including downtime between kills. */
  tripSeconds: number;
  /** Stats for each specific encounter in the sequence. */
  breakdown?: Omit<SpecResult, 'planId' | 'planName' | 'drainId' | 'dpsId' | 'breakdown'>[];
  /** Mean spec energy spent per kill. */
  energyUsed: number;
  /** Mean number of spec attacks over the whole trip. */
  meanSpecCasts: number;
  /** Seconds saved per kill vs the no-spec baseline. Negative = the spec is a loss. */
  secondsSaved: number;
  /** Seconds saved across the whole trip. */
  tripSecondsSaved: number;
  /** Seconds saved per 100% spec energy spent - the efficiency metric. */
  secondsPer100Energy: number;
  /** Histogram of kill times in ticks, for the distribution view. */
  hist: { tick: number; count: number }[];
  /** Full shape of the kill-time distribution, in ticks. */
  stats: DistStats;
}

