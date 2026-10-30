// Every value here comes from integer arithmetic on the seed alone, so the same
// seed replays the same numbers on any machine. Nothing reads a clock or the
// environment.

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T extends string>(weights: Record<T, number>): T;
}

const UINT32_RANGE = 4294967296;
const MULBERRY_STEP = 0x6d2b79f5;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + MULBERRY_STEP) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  }

  function int(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(items: readonly T[]): T {
    const item = items[int(0, items.length - 1)];
    if (items.length === 0 || item === undefined) {
      throw new Error('E_RNG_EMPTY');
    }
    return item;
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  function weighted<T extends string>(weights: Record<T, number>): T {
    const entries = (Object.entries(weights) as [T, number][]).filter(([, w]) => w > 0);
    if (entries.length === 0) {
      throw new Error('E_RNG_EMPTY');
    }
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    const target = next() * total;
    let acc = 0;
    for (const [key, w] of entries) {
      acc += w;
      if (target < acc) {
        return key;
      }
    }
    // Rounding can leave target equal to the running total; the last key owns that edge.
    const last = entries[entries.length - 1];
    if (last === undefined) {
      throw new Error('E_RNG_EMPTY');
    }
    return last[0];
  }

  return { next, int, pick, chance, weighted };
}

const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;

// Each step is reversible for a fixed other input, so changing only the seed or
// only the index always changes the result, and a ticket never depends on the
// ones drawn before it.
export function ticketSeed(seed: number, index: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), MIX_A);
  h = (h ^ (index >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), MIX_B);
  h ^= h >>> 16;
  return h >>> 0;
}
