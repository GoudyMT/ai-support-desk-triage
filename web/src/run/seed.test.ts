import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_LIVE_SEED, foldOf, parseSeed, randomSeed } from './seed';

const MAX_SEED = 4294967295;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSeed', () => {
  it('replays the run named in the address', () => {
    expect(parseSeed('?seed=1001')).toEqual({ seed: 1001, fromAddress: true, ignored: false });
  });

  it('accepts both ends of the live range', () => {
    expect(parseSeed(`?seed=${MIN_LIVE_SEED}`).seed).toBe(MIN_LIVE_SEED);
    expect(parseSeed(`?seed=${MAX_SEED}`).seed).toBe(MAX_SEED);
    expect(parseSeed(`?seed=${MAX_SEED}`).ignored).toBe(false);
  });

  it('finds the seed among other address parts', () => {
    expect(parseSeed('?x=1&seed=2002&y=2')).toEqual({ seed: 2002, fromAddress: true, ignored: false });
  });

  // A bad seed in a shared link must never break the page: it falls back to a fresh
  // run and says so.
  it.each([
    ['letters', '?seed=abc'],
    ['one below the range', '?seed=999'],
    ['a decimal', '?seed=1.5'],
    ['too large for 32 bits', '?seed=99999999999'],
    ['one above the range', `?seed=${MAX_SEED + 1}`],
    ['negative', '?seed=-5'],
    ['exponent form', '?seed=1e3'],
    ['padded', '?seed=%201001'],
    ['signed', '?seed=%2B1001'],
    ['empty', '?seed='],
  ])('refuses %s and starts a fresh run', (_name, search) => {
    const parsed = parseSeed(search);
    expect(parsed.ignored).toBe(true);
    expect(parsed.fromAddress).toBe(false);
    expect(Number.isInteger(parsed.seed)).toBe(true);
    expect(parsed.seed).toBeGreaterThanOrEqual(MIN_LIVE_SEED);
    expect(parsed.seed).toBeLessThanOrEqual(MAX_SEED);
  });

  it('starts a fresh run, with nothing said, when the address names no seed', () => {
    for (const search of ['', '?', '?other=1001']) {
      const parsed = parseSeed(search);
      expect(parsed.fromAddress).toBe(false);
      expect(parsed.ignored).toBe(false);
      expect(parsed.seed).toBeGreaterThanOrEqual(MIN_LIVE_SEED);
    }
  });
});

describe('randomSeed', () => {
  it('never returns a seed below the live range, however the random source falls', () => {
    const draws = [0, 999, 1000];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      array[0] = draws.shift() ?? 0;
      return array;
    }) as typeof crypto.getRandomValues);
    expect(randomSeed()).toBe(MIN_LIVE_SEED);
  });

  it('can return the top of the range', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      array[0] = MAX_SEED;
      return array;
    }) as typeof crypto.getRandomValues);
    expect(randomSeed()).toBe(MAX_SEED);
  });

  it('gives different seeds on different calls', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe('foldOf', () => {
  it('rotates through the four folds by seed', () => {
    expect([1000, 1001, 1002, 1003, 1004].map(foldOf)).toEqual([0, 1, 2, 3, 0]);
    expect(foldOf(MAX_SEED)).toBe(3);
  });
});
