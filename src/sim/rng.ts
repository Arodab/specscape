/** Small, fast, seedable PRNG (mulberry32). Deterministic runs make results reproducible. */
export type RNG = () => number;

export const mulberry32 = (seed: number): RNG => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Uniform integer in [lo, hi] inclusive. */
export const randInt = (rng: RNG, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));
