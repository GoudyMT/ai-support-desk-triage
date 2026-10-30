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

function drawInt(next: () => number, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error('E_RNG_RANGE');
  }
  return min + Math.floor(next() * (max - min + 1));
}

function drawWeighted<T extends string>(next: () => number, weights: Record<T, number>): T {
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

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + MULBERRY_STEP) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  }

  const int = (min: number, max: number): number => drawInt(next, min, max);

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('E_RNG_EMPTY');
    }
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error('E_RNG_EMPTY');
    }
    return item;
  }

  return {
    next,
    int,
    pick,
    chance: (p) => next() < p,
    weighted: (weights) => drawWeighted(next, weights),
  };
}

const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;

const INDEX_MIX_A = 0x7feb352d;
const INDEX_MIX_B = 0x846ca68b;

// Scrambles all 32 bits of a number so that nearby inputs land far apart. Every
// step is reversible, so two different inputs never give the same output.
function avalanche(value: number, mixA: number, mixB: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), mixA);
  h = Math.imul(h ^ (h >>> 13), mixB);
  return (h ^ (h >>> 16)) >>> 0;
}

// The seed and the index are each scrambled on their own, with different
// constants, before they are combined. Mixing the raw index in would let a small
// change to the seed cancel a change to the index, so one dataset's tickets would
// reappear under another seed. Only the two inputs matter, never the tickets drawn
// before, so any ticket can be rebuilt alone.
export function ticketSeed(seed: number, index: number): number {
  const mixedSeed = avalanche(seed, MIX_A, MIX_B);
  const mixedIndex = avalanche(index, INDEX_MIX_A, INDEX_MIX_B);
  return avalanche(mixedSeed ^ mixedIndex, MIX_A, MIX_B);
}
