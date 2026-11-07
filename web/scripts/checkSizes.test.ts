import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { compareSizes, measureDist, parseBudgets, type Budgets, type Measured } from './checkSizes';

const MEASURED: Measured = {
  pages: { demo: 30_000, desk: 5_000 },
  modelRawBytes: 3_300_000,
  modelGzipBytes: 900_000,
};
const limits = (demo: number | null, desk: number | null, model: number | null): Budgets => ({
  pages: {
    demo: { entry: 'under-the-hood.html', limit: demo },
    desk: { entry: 'index.html', limit: desk },
  },
  modelBytes: { limit: model },
});

describe('comparing measured sizes with the budgets', () => {
  it('passes when every size is within its limit, and prints one line per page and the model', () => {
    const result = compareSizes(MEASURED, limits(40_000, 6_000, 3_400_000));
    expect(result.failures).toEqual([]);
    const text = result.report.join('\n');
    expect(text).toMatch(/^page demo.*: 30000 bytes/m);
    expect(text).toMatch(/^page desk.*: 5000 bytes/m);
    expect(text).toContain('3300000');
    expect(text).toContain('900000');
  });

  it('accepts a size exactly at its limit and refuses one byte over, page by page', () => {
    expect(compareSizes(MEASURED, limits(30_000, 5_000, 3_300_000)).failures).toEqual([]);
    expect(compareSizes(MEASURED, limits(29_999, 5_000, 3_300_000)).failures).toEqual([
      { code: 'E_OVER_BUDGET', budget: 'pages.demo' },
    ]);
    expect(compareSizes(MEASURED, limits(30_000, 4_999, 3_300_000)).failures).toEqual([
      { code: 'E_OVER_BUDGET', budget: 'pages.desk' },
    ]);
    expect(compareSizes(MEASURED, limits(30_000, 5_000, 3_299_999)).failures).toEqual([
      { code: 'E_OVER_BUDGET', budget: 'modelBytes' },
    ]);
  });

  it('fails a budget whose limit the owner has not set, however small the size', () => {
    const tiny: Measured = { pages: { demo: 1, desk: 1 }, modelRawBytes: 1, modelGzipBytes: 1 };
    expect(compareSizes(tiny, limits(null, null, null)).failures).toEqual([
      { code: 'E_NO_LIMIT', budget: 'pages.demo' },
      { code: 'E_NO_LIMIT', budget: 'pages.desk' },
      { code: 'E_NO_LIMIT', budget: 'modelBytes' },
    ]);
  });

  it('fails only the page without a limit, so the demo can pass while the desk waits for the owner', () => {
    const result = compareSizes(MEASURED, limits(48_500, null, 3_850_000));
    expect(result.failures).toEqual([{ code: 'E_NO_LIMIT', budget: 'pages.desk' }]);
    expect(result.report.join('\n')).toContain('5000');
  });
});

describe('reading the budget file', () => {
  const GOOD = {
    pages: { demo: { entry: 'under-the-hood.html', limit: 5 }, desk: { entry: 'index.html', limit: null } },
    modelBytes: { limit: 7 },
  };

  it('reads a limit that is a number or null, with the page it belongs to', () => {
    expect(parseBudgets(GOOD)).toEqual({
      pages: { demo: { entry: 'under-the-hood.html', limit: 5 }, desk: { entry: 'index.html', limit: null } },
      modelBytes: { limit: 7 },
    });
  });

  it.each([
    ['not an object', 'x'],
    ['a missing model budget', { pages: GOOD.pages }],
    ['a missing pages list', { modelBytes: { limit: 7 } }],
    ['an empty pages list', { pages: {}, modelBytes: { limit: 7 } }],
    ['a page given as a bare number', { pages: { demo: 5 }, modelBytes: { limit: 7 } }],
    ['a page with no entry', { pages: { demo: { limit: 5 } }, modelBytes: { limit: 7 } }],
    ['a page with an empty entry', { pages: { demo: { entry: '', limit: 5 } }, modelBytes: { limit: 7 } }],
    ['a limit written as text', { pages: { demo: { entry: 'a.html', limit: '5' } }, modelBytes: { limit: 7 } }],
    ['a negative limit', { pages: GOOD.pages, modelBytes: { limit: -1 } }],
    ['the old single page budget', { pageGzipBytes: { limit: 5 }, modelBytes: { limit: 7 } }],
  ])('refuses %s', (_name, json) => {
    expect(() => parseBudgets(json)).toThrow('E_BUDGET_SHAPE');
  });
});

describe('measuring a built site', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function build(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'sizes-'));
    folders.push(root);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  const PAGES = {
    demo: { entry: 'under-the-hood.html' },
    desk: { entry: 'index.html' },
  };
  const gz = (text: string): number => gzipSync(text).length;
  const SHARED = 'export const shared = 1;\n'.repeat(300);
  const DEMO = 'export const demo = 2;\n'.repeat(120);
  const DESK = 'export const desk = 3;\n'.repeat(40);
  const LATER = 'export const later = 4;\n'.repeat(80);
  const STYLE = 'body { margin: 0 }\n'.repeat(60);
  const ORPHAN = 'export const orphan = 5;\n'.repeat(500);
  const MODEL = { 'models/fold_0.json': 'x'.repeat(1000), 'models/fold_1.json': 'y'.repeat(5000) };

  // The shape of Vite's manifest: one chunk per key, each naming the chunks and styles it loads.
  const MANIFEST = JSON.stringify({
    'index.html': { file: 'assets/desk.js', src: 'index.html', isEntry: true, imports: ['_shared.js'], css: ['assets/desk.css'] },
    'under-the-hood.html': {
      file: 'assets/demo.js',
      src: 'under-the-hood.html',
      isEntry: true,
      imports: ['_shared.js'],
      dynamicImports: ['later.ts'],
    },
    '_shared.js': { file: 'assets/shared.js' },
    'later.ts': { file: 'assets/later.js', src: 'later.ts', isDynamicEntry: true, imports: ['_shared.js'] },
  });

  const SITE = {
    '.vite/manifest.json': MANIFEST,
    'index.html': '<html></html>',
    'under-the-hood.html': '<html></html>',
    'assets/desk.js': DESK,
    'assets/desk.css': STYLE,
    'assets/demo.js': DEMO,
    'assets/shared.js': SHARED,
    'assets/later.js': LATER,
    'assets/orphan.js': ORPHAN,
    'assets/logo.png': 'not code'.repeat(1000),
    ...MODEL,
  };

  it('counts each page by what it loads: the shared chunk for both, on-demand parts and styles for their own page', () => {
    const measured = measureDist(build(SITE), PAGES);
    expect(measured.pages).toEqual({
      demo: gz(DEMO) + gz(SHARED) + gz(LATER),
      desk: gz(DESK) + gz(SHARED) + gz(STYLE),
    });
  });

  it('does not count a file that no page loads, nor files that are not code', () => {
    const withoutOrphan = Object.fromEntries(Object.entries(SITE).filter(([path]) => path !== 'assets/orphan.js'));
    expect(measureDist(build(SITE), PAGES).pages).toEqual(measureDist(build(withoutOrphan), PAGES).pages);
  });

  it('counts a chunk once for a page even when it is reached by two routes', () => {
    const manifest = JSON.stringify({
      'index.html': { file: 'assets/desk.js', imports: ['_shared.js', 'later.ts'] },
      '_shared.js': { file: 'assets/shared.js' },
      'later.ts': { file: 'assets/later.js', imports: ['_shared.js'] },
    });
    const dir = build({ ...SITE, '.vite/manifest.json': manifest });
    expect(measureDist(dir, { desk: { entry: 'index.html' } }).pages).toEqual({
      desk: gz(DESK) + gz(SHARED) + gz(LATER),
    });
  });

  it('takes the largest model file, and the shipped model when it is the largest', () => {
    const fold = measureDist(build(SITE), PAGES);
    expect(fold.modelRawBytes).toBe(5000);
    expect(fold.modelGzipBytes).toBe(gz('y'.repeat(5000)));
    const shipped = measureDist(build({ ...SITE, 'models/shipped.json': 'z'.repeat(9000) }), PAGES);
    expect(shipped.modelRawBytes).toBe(9000);
    expect(shipped.modelGzipBytes).toBe(gz('z'.repeat(9000)));
  });

  it('counts a page whose HTML loads no script as zero bytes, as the desk is before it has code', () => {
    const noDeskChunk = JSON.stringify({ 'under-the-hood.html': { file: 'assets/demo.js' } });
    const dir = build({ ...SITE, '.vite/manifest.json': noDeskChunk });
    expect(measureDist(dir, PAGES).pages).toEqual({ demo: gz(DEMO), desk: 0 });
  });

  it('says so when there is no build, no manifest, no model, or no HTML file for a page', () => {
    expect(() => measureDist(join(tmpdir(), 'sizes-no-such-folder'), PAGES)).toThrow('E_NO_BUILD');
    expect(() => measureDist(build({ 'assets/app.js': 'let a;', ...MODEL }), PAGES)).toThrow('E_NO_BUILD');
    expect(() => measureDist(build({ '.vite/manifest.json': MANIFEST, 'assets/app.js': 'let a;' }), PAGES)).toThrow(
      'E_NO_BUILD',
    );
    expect(() => measureDist(build(SITE), { other: { entry: 'missing.html' } })).toThrow('E_NO_ENTRY');
    const withoutShared = Object.fromEntries(Object.entries(SITE).filter(([path]) => path !== 'assets/shared.js'));
    expect(() => measureDist(build(withoutShared), PAGES)).toThrow('E_NO_BUILD');
  });
});
