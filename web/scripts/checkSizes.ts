// Measures the built page against the owner's size budgets: the page's code and styles
// (gzipped, summed) and the largest fold model (raw bytes, which the budget limits, and
// gzipped, for information). The limits live in size-budgets.json and are the owner's to set.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export interface Budgets {
  pageGzipBytes: { limit: number | null };
  modelBytes: { limit: number | null };
}

export interface Measured {
  pageGzipBytes: number;
  modelRawBytes: number;
  modelGzipBytes: number;
}

export interface SizeResult {
  report: string[];
  failures: { code: 'E_NO_LIMIT' | 'E_OVER_BUDGET'; budget: keyof Budgets }[];
}

const CODE_FILE = /\.(js|css)$/;
const MODEL_FILE = /^fold_\d+\.json$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLimit(budget: unknown): number | null {
  if (!isRecord(budget)) {
    throw new Error('E_BUDGET_SHAPE');
  }
  const limit = budget['limit'];
  if (limit === null) {
    return null;
  }
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
    throw new Error('E_BUDGET_SHAPE');
  }
  return limit;
}

/**
 * Reads the budget file's content.
 *
 * @param json The parsed content of size-budgets.json.
 * @returns Both budgets; a limit is a byte count, or null while the owner has not set it.
 * @throws Error('E_BUDGET_SHAPE') when a budget is missing or its limit is not a count or null.
 */
export function parseBudgets(json: unknown): Budgets {
  if (!isRecord(json)) {
    throw new Error('E_BUDGET_SHAPE');
  }
  return {
    pageGzipBytes: { limit: parseLimit(json['pageGzipBytes']) },
    modelBytes: { limit: parseLimit(json['modelBytes']) },
  };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Measures a production build.
 *
 * @param dir The build folder (`dist`).
 * @returns The gzipped size of every .js and .css file added together, and the raw and
 *   gzipped size of the largest `models/fold_<k>.json`.
 * @throws Error('E_NO_BUILD') when the folder or its model files are missing.
 */
export function measureDist(dir: string): Measured {
  if (!existsSync(dir)) {
    throw new Error('E_NO_BUILD');
  }
  const files = filesUnder(dir);
  const models = files.filter((path) => MODEL_FILE.test(path.split(/[\\/]/).at(-1) ?? ''));
  const largest = models
    .map((path) => ({ path, size: statSync(path).size }))
    .sort((a, b) => b.size - a.size)[0];
  if (largest === undefined) {
    throw new Error('E_NO_BUILD');
  }
  const pageGzipBytes = files
    .filter((path) => CODE_FILE.test(path))
    .reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0);
  return {
    pageGzipBytes,
    modelRawBytes: largest.size,
    modelGzipBytes: gzipSync(readFileSync(largest.path)).length,
  };
}

function judge(name: keyof Budgets, size: number, limit: number | null, failures: SizeResult['failures']): string {
  if (limit === null) {
    failures.push({ code: 'E_NO_LIMIT', budget: name });
    return 'no limit set';
  }
  if (size > limit) {
    failures.push({ code: 'E_OVER_BUDGET', budget: name });
    return `OVER by ${size - limit} bytes (limit ${limit})`;
  }
  return `within limit ${limit}`;
}

/**
 * Compares measured sizes with the budgets.
 *
 * @param measured What the build measures.
 * @param budgets The owner's limits.
 * @returns Lines to print, and one failure per budget that is over its limit
 *   (`E_OVER_BUDGET`) or has no limit yet (`E_NO_LIMIT`); a size equal to its limit passes.
 */
export function compareSizes(measured: Measured, budgets: Budgets): SizeResult {
  const failures: SizeResult['failures'] = [];
  const page = judge('pageGzipBytes', measured.pageGzipBytes, budgets.pageGzipBytes.limit, failures);
  const model = judge('modelBytes', measured.modelRawBytes, budgets.modelBytes.limit, failures);
  const report = [
    `page code and styles, gzipped: ${measured.pageGzipBytes} bytes - ${page}`,
    `largest model file, raw: ${measured.modelRawBytes} bytes - ${model}`,
    `largest model file, gzipped: ${measured.modelGzipBytes} bytes (for information)`,
    ...failures.map((failure) => `${failure.code}: ${failure.budget}`),
  ];
  return { report, failures };
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const budgets = parseBudgets(JSON.parse(readFileSync(join(root, 'size-budgets.json'), 'utf8')));
  const result = compareSizes(measureDist(join(root, 'dist')), budgets);
  console.log(result.report.join('\n'));
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

// Runs when started as `tsx scripts/checkSizes.ts`, not when a test imports the functions.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
