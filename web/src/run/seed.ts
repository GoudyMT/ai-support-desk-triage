// Live seeds start at 1000 (seeds below it belong to the course data sets) and end at
// the largest 32-bit value the ticket generator accepts.
export const MIN_LIVE_SEED = 1000;
export const MAX_LIVE_SEED = 4294967295;
export const FOLD_COUNT = 4;

const DIGITS_ONLY = /^[0-9]+$/;

export function randomSeed(): number {
  const draw = new Uint32Array(1);
  // Redrawing a value below the range (about 2 in 10 million) keeps every live seed
  // equally likely, which a modulo would not.
  do {
    crypto.getRandomValues(draw);
  } while ((draw[0] ?? 0) < MIN_LIVE_SEED);
  return draw[0] ?? MIN_LIVE_SEED;
}

export function foldOf(seed: number): number {
  return seed % FOLD_COUNT;
}

/**
 * Reads the run's seed from the page address.
 *
 * @param search The address's query string, such as `?seed=1001`.
 * @returns The seed to run; `fromAddress` when the address named a valid one;
 *   `ignored` when it named one that is not usable, so the page can say a fresh
 *   run was started instead. Never throws.
 */
export function parseSeed(search: string): { seed: number; fromAddress: boolean; ignored: boolean } {
  const given = new URLSearchParams(search).get('seed');
  if (given === null) {
    return { seed: randomSeed(), fromAddress: false, ignored: false };
  }
  const value = DIGITS_ONLY.test(given) ? Number(given) : Number.NaN;
  if (value >= MIN_LIVE_SEED && value <= MAX_LIVE_SEED) {
    return { seed: value, fromAddress: true, ignored: false };
  }
  return { seed: randomSeed(), fromAddress: false, ignored: true };
}
