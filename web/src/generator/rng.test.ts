import { describe, expect, it } from 'vitest';
import { createRng, ticketSeed } from './rng';

function firstValues(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe('createRng', () => {
  it('replays the same values for the same seed', () => {
    expect(firstValues(7, 5)).toEqual(firstValues(7, 5));
  });

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
  });

  it('throws on empty input instead of returning undefined', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.weighted({})).toThrow();
  });
});

describe('ticketSeed', () => {
  it('is stable for the same inputs', () => {
    expect(ticketSeed(42, 3)).toBe(ticketSeed(42, 3));
  });

  it('differs when the index or the seed changes', () => {
    expect(ticketSeed(42, 0)).not.toBe(ticketSeed(42, 1));
    expect(ticketSeed(42, 0)).not.toBe(ticketSeed(43, 0));
  });
});
