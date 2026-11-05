import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { compareSizes, measureDist, parseBudgets, type Budgets, type Measured } from './checkSizes';

const MEASURED: Measured = { pageGzipBytes: 30_000, modelRawBytes: 3_300_000, modelGzipBytes: 900_000 };
const limits = (page: number | null, model: number | null): Budgets => ({
  pageGzipBytes: { limit: page },
  modelBytes: { limit: model },
});

describe('comparing measured sizes with the budgets', () => {
  it('passes when both sizes are within their limits, and prints what was measured', () => {
    const result = compareSizes(MEASURED, limits(40_000, 3_400_000));
    expect(result.failures).toEqual([]);
    const text = result.report.join('\n');
    expect(text).toContain('30000');
    expect(text).toContain('3300000');
    expect(text).toContain('900000');
  });

  it('accepts a size exactly at its limit and refuses one byte over', () => {
    expect(compareSizes(MEASURED, limits(30_000, 3_300_000)).failures).toEqual([]);
    expect(compareSizes(MEASURED, limits(29_999, 3_300_000)).failures).toEqual([
      { code: 'E_OVER_BUDGET', budget: 'pageGzipBytes' },
    ]);
    expect(compareSizes(MEASURED, limits(30_000, 3_299_999)).failures).toEqual([
      { code: 'E_OVER_BUDGET', budget: 'modelBytes' },
    ]);
  });

  it('fails a budget whose limit the owner has not set, however small the size', () => {
    const tiny: Measured = { pageGzipBytes: 1, modelRawBytes: 1, modelGzipBytes: 1 };
    expect(compareSizes(tiny, limits(null, null)).failures).toEqual([
      { code: 'E_NO_LIMIT', budget: 'pageGzipBytes' },
      { code: 'E_NO_LIMIT', budget: 'modelBytes' },
    ]);
  });

  it('still prints the measured sizes when a limit is missing, so the owner can set it', () => {
    const text = compareSizes(MEASURED, limits(null, null)).report.join('\n');
    expect(text).toContain('30000');
    expect(text).toContain('3300000');
  });
});

describe('reading the budget file', () => {
  it('reads a limit that is a number or null', () => {
    expect(parseBudgets({ pageGzipBytes: { limit: 5 }, modelBytes: { limit: null } })).toEqual(limits(5, null));
  });

  it.each([
    ['not an object', 'x'],
    ['a missing budget', { pageGzipBytes: { limit: 5 } }],
    ['a limit written as text', { pageGzipBytes: { limit: '5' }, modelBytes: { limit: null } }],
    ['a negative limit', { pageGzipBytes: { limit: -1 }, modelBytes: { limit: null } }],
  ])('refuses %s', (_name, json) => {
    expect(() => parseBudgets(json)).toThrow('E_BUDGET_SHAPE');
  });
});

describe('measuring a built page', () => {
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

  it('sums the gzipped code and styles and takes the largest model file', () => {
    const script = 'const a = 1;\n'.repeat(200);
    const style = 'body { margin: 0 }\n'.repeat(100);
    const dir = build({
      'index.html': '<html></html>',
      'assets/app.js': script,
      'assets/app.css': style,
      'assets/logo.png': 'not code'.repeat(1000),
      'models/fold_0.json': 'x'.repeat(1000),
      'models/fold_1.json': 'y'.repeat(5000),
    });
    expect(measureDist(dir)).toEqual({
      pageGzipBytes: gzipSync(script).length + gzipSync(style).length,
      modelRawBytes: 5000,
      modelGzipBytes: gzipSync('y'.repeat(5000)).length,
    });
  });

  it('does not count the model files as page code', () => {
    const dir = build({ 'assets/app.js': 'let a;', 'models/fold_0.json': '{"big":"model"}' });
    expect(measureDist(dir).pageGzipBytes).toBe(gzipSync('let a;').length);
  });

  it('says so when there is no build to measure', () => {
    expect(() => measureDist(join(tmpdir(), 'sizes-no-such-folder'))).toThrow('E_NO_BUILD');
    expect(() => measureDist(build({ 'assets/app.js': 'let a;' }))).toThrow('E_NO_BUILD');
  });
});
