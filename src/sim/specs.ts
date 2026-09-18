import type { AttackType, DefStyle, Loadout, MonsterState } from './types';
import { drainLimit } from './defenceFloors';
import { randInt, type RNG } from './rng';

/**
 * Special attack definitions.
 *
 * Damage and accuracy multipliers follow the OSRS Wiki's documented mechanics.
 * Truncation order is preserved (OSRS floors after every multiplier), because
 * e.g. the Bandos godsword is two chained 11/10 factors, not a single 1.21.
 */

/** OSRS applies multipliers as integer factors, truncating each time. */
export const factor = (v: number, num: number, den: number): number => Math.trunc((v * num) / den);

export interface SpecCtx {
  /** The spec weapon's own resolved loadout (its max hit, attack roll, speed). */
  load: Loadout;
  /** Hit chance for this spec, already adjusted for accMult and style override. */
  acc: number;
  rng: RNG;
  state: MonsterState;
  monsterName: string;
  /** True when the target has the demon attribute (Arclight/Emberlight scaling). */
  isDemon: boolean;
  /** Per-spec toggles, keyed by SpecDef.option.key. */
  options: Record<string, boolean>;
}

export interface SpecDef {
  id: string;
  name: string;
  /** Item name, used to look up the weapon's stats in equipment.json. */
  item: string;
  /** Special attack energy cost, %. */
  cost: number;
  /** Ticks the spec attack occupies. */
  speed: number;
  type: AttackType;
  /** Defence stat this spec rolls against (specs often differ from the weapon's normal style). */
  defStyle: DefStyle;
  /** Accuracy multiplier applied to the attack roll. */
  accMult: number;
  /** True when the spec always hits and skips the accuracy roll entirely. */
  guaranteed?: boolean;
  /** Does this spec reduce the target's Defence? Drives UI grouping. */
  drains?: boolean;
  /**
   * When the spec is worth using.
   * - 'opening': only at the very start of a fight, before any main-weapon attack.
   *   Defence drains are pointless later - there is no kill left for them to pay back over.
   * - 'greedy': any time the energy is available.
   * Defaults to 'opening' for drains and 'greedy' otherwise.
   */
  policy?: 'opening' | 'greedy';
  /** If set, this spec cannot be cast more than this many times per kill. */
  maxCasts?: number;
  /** If set, this spec is no longer cast once it successfully hits at least once per kill. */
  stopOnHit?: boolean;
  /** An optional per-spec toggle the UI renders next to the spec. */
  option?: { key: string; label: string; default: boolean };
  /**
   * For specs whose damage comes from a level formula rather than the weapon's
   * own max hit (the Volatile staff). Resolved before the simulation runs.
   */
  levelMaxHit?: (magicLevel: number) => number;
  note?: string;
  /** Spec max hit, derived from the weapon's normal max hit. */
  maxHit(base: number): number;
  /** Roll the spec. Returns hitsplats, and may mutate `state` for drains. */
  hits(ctx: SpecCtx, specMax: number): number[];
}

/** Reduce the target's Defence, respecting per-boss drain floors. */
const reduceDef = (ctx: SpecCtx, next: (cur: number) => number): void => {
  const { floor } = drainLimit(ctx.monsterName, ctx.state.def);
  ctx.state.def = Math.max(floor, next(ctx.state.def));
};

const rollHit = (ctx: SpecCtx): boolean => ctx.rng() < ctx.acc;
const uniformDamage = (ctx: SpecCtx, max: number): number => randInt(ctx.rng, 0, max);

/** Standard single-hit spec: one accuracy roll, uniform 0..max damage. */
const singleHit = (ctx: SpecCtx, specMax: number): number[] =>
  rollHit(ctx) ? [uniformDamage(ctx, specMax)] : [0];

/** Two independent hits, each with its own accuracy roll. */
const doubleHit = (ctx: SpecCtx, specMax: number): number[] => [
  rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
  rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
];

/**
 * Dragon claws: up to four accuracy rolls. The first roll that lands decides
 * the damage split; if all four miss there is still a 2/3 chance of two 1s.
 */
const clawCascade = (ctx: SpecCtx, max: number, totalRolls: number, highOffset: number): number[] => {
  for (let accRoll = 0; accRoll < totalRolls; accRoll++) {
    if (!rollHit(ctx)) continue;
    const low = Math.trunc((max * (totalRolls - accRoll)) / 4);
    const high = max + low + highOffset;
    const dmg = randInt(ctx.rng, low, high);
    switch (accRoll) {
      case 0:
        return [
          Math.trunc(dmg / 2), Math.trunc(dmg / 4),
          Math.trunc(dmg / 8), Math.trunc(dmg / 8) + 1,
        ];
      case 1:
        return [Math.trunc(dmg / 2), Math.trunc(dmg / 4), Math.trunc(dmg / 4) + 1];
      case 2:
        return [Math.trunc(dmg / 2), Math.trunc(dmg / 2) + 1];
      default:
        return [dmg + 1];
    }
  }
  // All rolls failed: 2/3 of the time claws still chip for 1 + 1.
  return ctx.rng() < 2 / 3 ? [1, 1] : [0];
};

export const SPECS: SpecDef[] = [
  // ---------- damage specs ----------
  {
    id: 'voidwaker',
    name: 'Voidwaker',
    item: 'Voidwaker',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'magic',
    accMult: 1,
    guaranteed: true,
    drains: false,
    note: 'Always hits. Damage is 50%-150% of max hit, so it ignores the target Defence entirely.',
    maxHit: (base) => base + factor(base, 1, 2),
    hits: (ctx, specMax) => {
      // specMax is base * 1.5, so the floor of the range is one third of it.
      const min = factor(specMax, 1, 3);
      return [randInt(ctx.rng, min, specMax)];
    },
  },
  {
    id: 'dragon_claws',
    name: 'Dragon claws',
    item: 'Dragon claws',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1,
    note: 'Four accuracy rolls. Very high damage when the first roll lands, but no accuracy bonus.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => clawCascade(ctx, specMax, 4, -1),
  },
  {
    id: 'burning_claws',
    name: 'Burning claws',
    item: 'Burning claws',
    cost: 30,
    speed: 4,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1,
    note: 'Cheaper than dragon claws at 30%, three accuracy rolls.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => clawCascade(ctx, specMax, 3, 0),
  },
  {
    id: 'sgs',
    name: 'Saradomin godsword',
    item: 'Saradomin godsword',
    cost: 50,
    speed: 6,
    type: 'melee',
    defStyle: 'slash',
    accMult: 2,
    note: 'Double accuracy, 1.1x damage, and heals half the damage dealt.',
    maxHit: (base) => factor(base, 11, 10),
    hits: singleHit,
  },
  {
    id: 'zgs',
    name: 'Zamorak godsword',
    item: 'Zamorak godsword',
    cost: 50,
    speed: 6,
    type: 'melee',
    defStyle: 'slash',
    accMult: 2,
    note: 'Double accuracy, 1.1x damage, freezes the target.',
    maxHit: (base) => factor(base, 11, 10),
    hits: singleHit,
  },
  {
    id: 'dragon_dagger',
    name: 'Dragon dagger',
    item: 'Dragon dagger',
    cost: 25,
    speed: 4,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1.15,
    note: 'Two hits at 1.15x damage for only 25% energy - cheap and spammable.',
    maxHit: (base) => factor(base, 23, 20),
    hits: doubleHit,
  },
  {
    id: 'abyssal_dagger',
    name: 'Abyssal dagger',
    item: 'Abyssal dagger',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1.25,
    note: 'Two hits at 0.85x damage with 1.25x accuracy.',
    maxHit: (base) => factor(base, 17, 20),
    hits: doubleHit,
  },
  {
    id: 'fang',
    name: 'Osmumtens fang',
    item: "Osmumten's fang",
    cost: 25,
    speed: 5,
    type: 'melee',
    defStyle: 'stab',
    accMult: 1.5,
    note: '1.5x accuracy for 25% energy. Strong against high-Defence targets.',
    maxHit: (base) => base,
    hits: singleHit,
  },

  {
    id: 'crystal_halberd',
    name: 'Crystal halberd',
    item: 'Crystal halberd',
    cost: 30,
    speed: 7,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1,
    note: 'Hits twice against targets larger than 1x1, at 1.1x damage, for only 30% energy.',
    maxHit: (base) => factor(base, 11, 10),
    hits: doubleHit,
  },
  {
    id: 'bone_dagger',
    name: 'Bone dagger',
    item: 'Bone dagger',
    cost: 25,
    speed: 4,
    type: 'melee',
    defStyle: 'stab',
    accMult: 1,
    guaranteed: true,
    drains: true,
    maxCasts: 1,
    policy: 'opening',
    option: { key: 'boneDaggerOpener', label: 'Bone dagger: 100% accuracy opener', default: true },
    note: 'Drains Defence by the damage dealt. Guaranteed to hit as an opener, which is how it is normally used. Can only be used once per target.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      const opener = ctx.options.boneDaggerOpener !== false;
      if (!opener && !rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },

  // ---------- ranged specs ----------
  {
    id: 'zcb',
    name: 'Zaryte crossbow',
    item: 'Zaryte crossbow',
    cost: 75,
    speed: 6,
    type: 'ranged',
    defStyle: 'heavy',
    accMult: 2,
    note: 'On a successful hit, guarantees a ruby bolt proc for 22% of the target’s CURRENT HP, capped at 110. Still has to land the attack, so it needs real ranged gear - specced out of a melee setup it mostly misses.',
    maxHit: (base) => base,
    // The ruby effect replaces the normal hit, so damage does not scale with the
    // weapon's max hit - but the attack roll still has to succeed first.
    hits: (ctx) => {
      if (!rollHit(ctx)) return [0];
      return [Math.min(110, Math.trunc((ctx.state.hp * 22) / 100))];
    },
  },
  {
    id: 'dragon_knife',
    name: 'Dragon knife',
    item: 'Dragon knife',
    cost: 25,
    speed: 3,
    type: 'ranged',
    defStyle: 'light',
    accMult: 1,
    note: 'Two knives for 25% energy on a 3-tick weapon - cheap and very spammable.',
    maxHit: (base) => base,
    hits: doubleHit,
  },
  {
    id: 'dragon_thrownaxe',
    name: 'Dragon thrownaxe',
    item: 'Dragon thrownaxe',
    cost: 25,
    speed: 1,
    type: 'ranged',
    defStyle: 'light',
    accMult: 1,
    note: 'Cheap at 25%, but its real value is bouncing between multiple targets, which this single-target simulation does not model.',
    maxHit: (base) => base,
    hits: singleHit,
  },
  {
    id: 'webweaver',
    name: 'Webweaver bow',
    item: 'Webweaver bow',
    cost: 50,
    speed: 4,
    type: 'ranged',
    defStyle: 'standard',
    accMult: 2,
    note: 'Four shots at 40% damage each with double accuracy.',
    maxHit: (base) => base - factor(base, 6, 10),
    hits: (ctx, specMax) => [
      rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
      rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
      rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
      rollHit(ctx) ? uniformDamage(ctx, specMax) : 0,
    ],
  },
  {
    id: 'dark_bow',
    name: 'Dark bow',
    item: 'Dark bow',
    cost: 55,
    speed: 9,
    type: 'ranged',
    defStyle: 'standard',
    accMult: 1,
    note: 'Two arrows at 1.5x damage with a minimum of 8 each for dragon arrows (1.3x and min 5 for others).',
    maxHit: (base) => factor(base, 15, 10), // UI will assume dragon arrows
    hits: (ctx, specMax) => {
      // specMax here is already multiplied by 1.5 because of the above maxHit function.
      const isDragon = ctx.load.ammoName?.toLowerCase().includes('dragon');
      const minHit = isDragon ? 8 : 5;
      const actualMax = isDragon ? specMax : factor(ctx.load.maxHit, 13, 10);
      
      return [
        rollHit(ctx) ? randInt(ctx.rng, minHit, Math.max(minHit, actualMax)) : 0,
        rollHit(ctx) ? randInt(ctx.rng, minHit, Math.max(minHit, actualMax)) : 0,
      ];
    },
  },

  // ---------- defence drain specs ----------
  {
    id: 'dwh_1',
    name: 'Dragon warhammer (1 cast)',
    item: 'Dragon warhammer',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1, drains: true, maxCasts: 1,
    note: 'Drains 30% of current Defence on hit.',
    maxHit: (base) => factor(base, 3, 2),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 3, 10));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'dwh_2',
    name: 'Dragon warhammer (2 casts)',
    item: 'Dragon warhammer',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1, drains: true, maxCasts: 2,
    note: 'Drains 30% of current Defence on hit.',
    maxHit: (base) => factor(base, 3, 2),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 3, 10));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'dwh_3',
    name: 'Dragon warhammer (3 casts)',
    item: 'Dragon warhammer',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1, drains: true, maxCasts: 3,
    note: 'Drains 30% of current Defence on hit.',
    maxHit: (base) => factor(base, 3, 2),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 3, 10));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'dwh_4',
    name: 'Dragon warhammer (4 casts)',
    item: 'Dragon warhammer',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1, drains: true, maxCasts: 4,
    note: 'Drains 30% of current Defence on hit.',
    maxHit: (base) => factor(base, 3, 2),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 3, 10));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'dwh_hit',
    name: 'Dragon warhammer (until 1 lands)',
    item: 'Dragon warhammer',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1, drains: true, stopOnHit: true,
    note: 'Drains 30% of current Defence on hit. Stops casting once a hit lands.',
    maxHit: (base) => factor(base, 3, 2),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 3, 10));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'elder_maul_1',
    name: 'Elder maul (1 cast)',
    item: 'Elder maul',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1.25, drains: true, maxCasts: 1,
    note: 'Drains 35% of current Defence on hit.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 35, 100));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'elder_maul_2',
    name: 'Elder maul (2 casts)',
    item: 'Elder maul',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1.25, drains: true, maxCasts: 2,
    note: 'Drains 35% of current Defence on hit.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 35, 100));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'elder_maul_3',
    name: 'Elder maul (3 casts)',
    item: 'Elder maul',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1.25, drains: true, maxCasts: 3,
    note: 'Drains 35% of current Defence on hit.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 35, 100));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'elder_maul_4',
    name: 'Elder maul (4 casts)',
    item: 'Elder maul',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1.25, drains: true, maxCasts: 4,
    note: 'Drains 35% of current Defence on hit.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 35, 100));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'elder_maul_hit',
    name: 'Elder maul (until 1 lands)',
    item: 'Elder maul',
    cost: 50, speed: 6, type: 'melee', defStyle: 'crush', accMult: 1.25, drains: true, stopOnHit: true,
    note: 'Drains 35% of current Defence on hit. Stops casting once a hit lands.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => cur - factor(cur, 35, 100));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'bgs_1',
    name: 'Bandos godsword (1 cast)',
    item: 'Bandos godsword',
    cost: 50, speed: 6, type: 'melee', defStyle: 'slash', accMult: 2, drains: true, maxCasts: 1,
    note: 'Drains Defence by the damage dealt.',
    maxHit: (base) => factor(factor(base, 11, 10), 11, 10),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },
  {
    id: 'bgs_2',
    name: 'Bandos godsword (2 casts)',
    item: 'Bandos godsword',
    cost: 50, speed: 6, type: 'melee', defStyle: 'slash', accMult: 2, drains: true, maxCasts: 2,
    note: 'Drains Defence by the damage dealt.',
    maxHit: (base) => factor(factor(base, 11, 10), 11, 10),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },
  {
    id: 'bgs_3',
    name: 'Bandos godsword (3 casts)',
    item: 'Bandos godsword',
    cost: 50, speed: 6, type: 'melee', defStyle: 'slash', accMult: 2, drains: true, maxCasts: 3,
    note: 'Drains Defence by the damage dealt.',
    maxHit: (base) => factor(factor(base, 11, 10), 11, 10),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },
  {
    id: 'bgs_4',
    name: 'Bandos godsword (4 casts)',
    item: 'Bandos godsword',
    cost: 50, speed: 6, type: 'melee', defStyle: 'slash', accMult: 2, drains: true, maxCasts: 4,
    note: 'Drains Defence by the damage dealt.',
    maxHit: (base) => factor(factor(base, 11, 10), 11, 10),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },
  {
    id: 'bgs_hit',
    name: 'Bandos godsword (until 1 lands)',
    item: 'Bandos godsword',
    cost: 50, speed: 6, type: 'melee', defStyle: 'slash', accMult: 2, drains: true, stopOnHit: true,
    note: 'Drains Defence by the damage dealt. Stops casting once a hit lands.',
    maxHit: (base) => factor(factor(base, 11, 10), 11, 10),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      reduceDef(ctx, (cur) => cur - dmg);
      return [dmg];
    },
  },
  {
    id: 'arclight',
    name: 'Arclight',
    item: 'Arclight',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'stab',
    accMult: 1,
    drains: true,
    note: 'Drains 10% of BASE Defence per hit against demons (5% otherwise). Stacks linearly, unlike DWH.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const num = ctx.isDemon ? 2 : 1;
      reduceDef(ctx, (cur) => cur - (factor(ctx.state.baseDef, num, 20) + 1));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'emberlight',
    name: 'Emberlight',
    item: 'Emberlight',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'stab',
    accMult: 1,
    drains: true,
    note: 'Drains 15% of BASE Defence per hit against demons (5% otherwise).',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const num = ctx.isDemon ? 3 : 1;
      reduceDef(ctx, (cur) => cur - (factor(ctx.state.baseDef, num, 20) + 1));
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'volatile',
    name: 'Volatile Nightmare staff',
    item: 'Volatile Nightmare staff',
    cost: 55,
    speed: 5,
    type: 'magic',
    defStyle: 'magic',
    accMult: 1.5,
    note: 'Damage scales with Magic level rather than the staff, capped at 58, with 1.5x accuracy.',
    levelMaxHit: (magicLevel) => Math.max(1, Math.min(58, Math.trunc((99 + 58 * magicLevel) / 99))),
    maxHit: (base) => base,
    hits: singleHit,
  },
  {
    id: 'accursed_sceptre',
    name: 'Accursed sceptre',
    item: 'Accursed sceptre',
    cost: 50,
    speed: 4,
    type: 'magic',
    defStyle: 'magic',
    accMult: 1,
    drains: true,
    note: 'Drains 15% of Defence and Magic. Does not stack with itself.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      reduceDef(ctx, (cur) => factor(cur, 17, 20));
      ctx.state.magic = factor(ctx.state.magic, 17, 20);
      return [uniformDamage(ctx, specMax)];
    },
  },
  {
    id: 'arkan',
    name: 'Arkan blade',
    item: 'Arkan blade',
    cost: 50,
    speed: 4,
    type: 'melee',
    defStyle: 'slash',
    accMult: 1,
    note: 'Attacks with a 25% increase in max hit, and lowers their Magic level by 5% + 1.',
    maxHit: (base) => factor(base, 5, 4),
    hits: (ctx, specMax) => {
      if (!rollHit(ctx)) return [0];
      const dmg = uniformDamage(ctx, specMax);
      ctx.state.magic = Math.max(0, ctx.state.magic - factor(ctx.state.magic, 5, 100) - 1);
      return [dmg];
    },
  },
  {
    id: 'd_thrownaxe',
    name: 'Dragon thrownaxe',
    item: 'Dragon thrownaxe',
    cost: 25,
    speed: 1,
    type: 'ranged',
    defStyle: 'standard',
    accMult: 1.25,
    note: 'Throws an axe with 25% increased accuracy. Attacks incredibly fast.',
    maxHit: (base) => base,
    hits: (ctx, specMax) => rollHit(ctx) ? [uniformDamage(ctx, specMax)] : [0],
  }
];

export const specById = (id: string): SpecDef | undefined => SPECS.find((s) => s.id === id);

/**
 * Defence drains only pay off if there is a kill left for them to pay back over,
 * so they are restricted to the opening of a fight unless a spec says otherwise.
 */
export const specPolicy = (def: SpecDef): 'opening' | 'greedy' =>
  def.policy ?? (def.drains ? 'opening' : 'greedy');

export type { Loadout, MonsterState, DefStyle };
