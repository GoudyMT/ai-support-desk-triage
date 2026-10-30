import { describe, expect, it } from 'vitest';
import { createRng, ticketSeed } from './rng';

function firstValues(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

// The seeds and sizes the dataset export uses, and the demo seeds start at 1000.
const TRAIN_SEED = 1;
const TRAIN_COUNT = 20000;
const HELD_OUT_SEED = 2;
const HELD_OUT_COUNT = 4000;
const FIRST_DEMO_SEED = 1000;
const DEMO_SEED_COUNT = 1000;
const DEMO_TICKET_COUNT = 500;
const MAX_CHANCE_REPLAYS = 1;
// Demo seeds whose first 500 tickets all land on training tickets if the raw
// index is XORed into the mixed seed.
const SEEDS_THAT_REPLAY_500_TICKETS = [5600, 11199, 639748, 645349, 650946];

describe('createRng', () => {
  it('gives different values for different seeds', () => {
    expect(firstValues(7, 5)).not.toEqual(firstValues(8, 5));
  });

  // Pins replay across machines: a changed constant or a platform-dependent
  // operation would shift these numbers and every dataset with them.
  it('matches the pinned values for seed 42', () => {
    expect(firstValues(42, 3)).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });

  it('draws int(1, 3) from exactly 1, 2 and 3', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i += 1) {
      seen.add(rng.int(1, 3));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('never picks a zero-weight key', () => {
    const rng = createRng(5);
    for (let i = 0; i < 1000; i += 1) {
      expect(rng.weighted({ a: 0, b: 1 })).toBe('b');
    }
    expect(() => rng.weighted({ a: 0 })).toThrow('E_RNG_EMPTY');
  });

  it('refuses ranges it cannot honour instead of returning a number outside them', () => {
    const rng = createRng(1);
    expect(() => rng.int(0, 2.5)).toThrow('E_RNG_RANGE');
    expect(() => rng.int(5, 3)).toThrow('E_RNG_RANGE');
    expect(() => rng.int(Number.NaN, 3)).toThrow('E_RNG_RANGE');
  });

  it('throws on empty input instead of returning undefined', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.weighted({})).toThrow();
  });
});

describe('ticketSeed', () => {
  it('differs when the index or the seed changes', () => {
    expect(ticketSeed(42, 0)).not.toBe(ticketSeed(42, 1));
    expect(ticketSeed(42, 0)).not.toBe(ticketSeed(43, 0));
  });

  // A repeated per-ticket seed is a repeated ticket: inside the training set it
  // inflates the training score, and across sets it leaks held-out tickets.
  it('gives the training and held-out sets 24,000 different ticket seeds', () => {
    const train = new Set<number>();
    for (let i = 0; i < TRAIN_COUNT; i += 1) {
      train.add(ticketSeed(TRAIN_SEED, i));
    }
    expect(train.size).toBe(TRAIN_COUNT);
    for (let i = 0; i < HELD_OUT_COUNT; i += 1) {
      expect(train.has(ticketSeed(HELD_OUT_SEED, i)), `held-out index ${i}`).toBe(false);
    }
  });

  // A demo run must show tickets the model has never seen, whatever demo seed the
  // visitor picks. 32-bit seeds allow rare single coincidences, never a run.
  it('never lets a demo seed replay a run of training or held-out tickets', () => {
    const used = new Set<number>();
    for (let i = 0; i < TRAIN_COUNT; i += 1) {
      used.add(ticketSeed(TRAIN_SEED, i));
    }
    for (let i = 0; i < HELD_OUT_COUNT; i += 1) {
      used.add(ticketSeed(HELD_OUT_SEED, i));
    }
    expect(ticketSeed(5600, 0)).not.toBe(ticketSeed(TRAIN_SEED, 11979));
    const demoSeeds = [
      ...Array.from({ length: DEMO_SEED_COUNT }, (_, offset) => FIRST_DEMO_SEED + offset),
      ...SEEDS_THAT_REPLAY_500_TICKETS,
    ];
    for (const seed of demoSeeds) {
      let replayed = 0;
      for (let i = 0; i < DEMO_TICKET_COUNT; i += 1) {
        if (used.has(ticketSeed(seed, i))) {
          replayed += 1;
        }
      }
      expect(replayed, `demo seed ${seed}`).toBeLessThanOrEqual(MAX_CHANCE_REPLAYS);
    }
  });
});
