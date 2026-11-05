// Measures the built site against the owner's size budgets: each page's code and styles
// (gzipped, summed over everything that page loads) and the largest model file (raw bytes,
// which the budget limits, and gzipped, for information). The limits live in size-budgets.json
// and are the owner's to set.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export interface PageBudget {
  entry: string;
  limit: number | null;
}

export interface Budgets {
  pages: Record<string, PageBudget>;
  modelBytes: { limit: number | null };
}

export interface Measured {
  pages: Record<string, number>;
  modelRawBytes: number;
  modelGzipBytes: number;
}

export interface SizeResult {
  report: string[];
  failures: { code: 'E_NO_LIMIT' | 'E_OVER_BUDGET'; budget: string }[];
}

interface ManifestChunk {
  file: string;
  imports: string[];
  dynamicImports: string[];
  css: string[];
}

const CODE_FILE = /\.(js|css)$/;
const MODEL_FILE = /^(fold_\d+|shipped)\.json$/;

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
 * @returns The page budgets (each with the HTML file that starts the page) and the model budget;
 *   a limit is a byte count, or null while the owner has not set it.
 * @throws Error('E_BUDGET_SHAPE') when a budget is missing, a page has no entry file, or a limit is
 *   not a count or null.
 */
export function parseBudgets(json: unknown): Budgets {
  if (!isRecord(json)) {
    throw new Error('E_BUDGET_SHAPE');
  }
  const pages = json['pages'];
  if (!isRecord(pages) || Object.keys(pages).length === 0) {
    throw new Error('E_BUDGET_SHAPE');
  }
  return {
    pages: Object.fromEntries(
      Object.entries(pages).map(([name, page]) => {
        const entry = isRecord(page) ? page['entry'] : undefined;
        if (typeof entry !== 'string' || entry === '') {
          throw new Error('E_BUDGET_SHAPE');
        }
        return [name, { entry, limit: parseLimit(page) }];
      }),
    ),
    modelBytes: { limit: parseLimit(json['modelBytes']) },
  };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readManifest(dir: string): Map<string, ManifestChunk> {
  const path = join(dir, '.vite', 'manifest.json');
  if (!existsSync(path)) {
    throw new Error('E_NO_BUILD');
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('E_NO_BUILD');
  }
  const chunks = new Map<string, ManifestChunk>();
  for (const [key, chunk] of Object.entries(parsed)) {
    if (isRecord(chunk) && typeof chunk['file'] === 'string') {
      chunks.set(key, {
        file: chunk['file'],
        imports: strings(chunk['imports']),
        dynamicImports: strings(chunk['dynamicImports']),
        css: strings(chunk['css']),
      });
    }
  }
  return chunks;
}

// The code and style files a page loads: its entry chunk, and everything that chunk imports, loads
// on demand or styles itself with, followed all the way down. A shared chunk is counted for each
// page that reaches it, and once for a page that reaches it twice. A page whose HTML has no script
// has no chunk in the manifest and loads no files of its own.
function pageFiles(entry: string, chunks: Map<string, ManifestChunk>): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    const chunk = chunks.get(key);
    if (chunk === undefined || seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const file of [chunk.file, ...chunk.css]) {
      if (CODE_FILE.test(file)) {
        files.add(file);
      }
    }
    queue.push(...chunk.imports, ...chunk.dynamicImports);
  }
  return files;
}

/**
 * Measures a production build.
 *
 * @param dir The build folder (`dist`), with Vite's manifest in `.vite/manifest.json`.
 * @param pages Each page's name and the HTML file that starts it.
 * @returns For each page, the gzipped size of every .js and .css file it loads added together
 *   (on-demand parts included); and the raw and gzipped size of the largest model file
 *   (`models/fold_<k>.json` or `models/shipped.json`).
 * @throws Error('E_NO_BUILD') when the folder, the manifest, a file the manifest names or the model
 *   files are missing; Error('E_NO_ENTRY') when a page's HTML file is not in the build.
 */
export function measureDist(dir: string, pages: Record<string, { entry: string }>): Measured {
  if (!existsSync(dir)) {
    throw new Error('E_NO_BUILD');
  }
  const models = filesUnder(dir).filter((path) => MODEL_FILE.test(path.split(/[\\/]/).at(-1) ?? ''));
  const largest = models
    .map((path) => ({ path, size: statSync(path).size }))
    .sort((a, b) => b.size - a.size)[0];
  if (largest === undefined) {
    throw new Error('E_NO_BUILD');
  }
  const chunks = readManifest(dir);
  const sizes = Object.entries(pages).map(([name, page]): [string, number] => {
    if (!existsSync(join(dir, page.entry))) {
      throw new Error('E_NO_ENTRY');
    }
    const bytes = [...pageFiles(page.entry, chunks)].reduce((sum, file) => {
      const path = join(dir, file);
      if (!existsSync(path)) {
        throw new Error('E_NO_BUILD');
      }
      return sum + gzipSync(readFileSync(path)).length;
    }, 0);
    return [name, bytes];
  });
  return {
    pages: Object.fromEntries(sizes),
    modelRawBytes: largest.size,
    modelGzipBytes: gzipSync(readFileSync(largest.path)).length,
  };
}

function judge(name: string, size: number, limit: number | null, failures: SizeResult['failures']): string {
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
 *   (`E_OVER_BUDGET`) or has no limit yet (`E_NO_LIMIT`), named `pages.<page>` or `modelBytes`;
 *   a size equal to its limit passes.
 */
export function compareSizes(measured: Measured, budgets: Budgets): SizeResult {
  const failures: SizeResult['failures'] = [];
  const pages = Object.entries(measured.pages).map(
    ([name, size]) =>
      `page ${name}, code and styles loaded, gzipped: ${size} bytes - ${judge(`pages.${name}`, size, budgets.pages[name]?.limit ?? null, failures)}`,
  );
  const model = judge('modelBytes', measured.modelRawBytes, budgets.modelBytes.limit, failures);
  const report = [
    ...pages,
    `largest model file, raw: ${measured.modelRawBytes} bytes - ${model}`,
    `largest model file, gzipped: ${measured.modelGzipBytes} bytes (for information)`,
    ...failures.map((failure) => `${failure.code}: ${failure.budget}`),
  ];
  return { report, failures };
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const budgets = parseBudgets(JSON.parse(readFileSync(join(root, 'size-budgets.json'), 'utf8')));
  const result = compareSizes(measureDist(join(root, 'dist'), budgets.pages), budgets);
  console.log(result.report.join('\n'));
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

// Runs when started as `tsx scripts/checkSizes.ts`, not when a test imports the functions.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
