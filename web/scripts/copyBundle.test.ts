import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLE_FILES, RUNTIME_FILES, SERVED_FILES, bundleFingerprint, copyBundle, copyRuntime, readBundle } from './copyBundle';

// The site serves the sentence model the desk runs. It must be the very bundle the
// records measured, so the copy is refused unless its fingerprint is the recorded one.
const BUNDLE = fileURLToPath(new URL('../../ml/models/bundle_v2/', import.meta.url));
const RECORDED = (JSON.parse(readFileSync(new URL('../../ml/reports/bundle_v2.json', import.meta.url), 'utf8')) as { fingerprint: string }).fingerprint;

function copyOf(dir: string): string {
  const copy = mkdtempSync(join(tmpdir(), 'bundle-'));
  for (const name of SERVED_FILES) {
    copyFileSync(join(dir, name), join(copy, name));
  }
  return copy;
}

describe('bundleFingerprint', () => {
  it('matches the fingerprint the Python scorer recorded for the bundle', () => {
    expect(bundleFingerprint(readBundle(BUNDLE))).toBe(RECORDED);
  });

  it('reads a JSON file checked out with Windows line ends as the same bundle', () => {
    const copy = copyOf(BUNDLE);
    const heads = readFileSync(join(copy, 'heads.json'), 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(join(copy, 'heads.json'), heads.replace(/\n/g, '\r\n'));
    expect(bundleFingerprint(readBundle(copy))).toBe(RECORDED);
  });
});

describe('copyBundle', () => {
  it('copies the model, its tokenizer and heads, and its license notices', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'served-')), 'bundle_v2');
    copyBundle(BUNDLE, out, RECORDED);
    expect(readdirSync(out).sort()).toEqual([...SERVED_FILES].sort());
    expect(bundleFingerprint(readBundle(out))).toBe(RECORDED);
    expect(BUNDLE_FILES.every((name) => SERVED_FILES.includes(name))).toBe(true);
  });

  it('refuses a bundle whose fingerprint is not the recorded one and writes nothing', () => {
    const copy = copyOf(BUNDLE);
    const manifest = readFileSync(join(copy, 'manifest.json'), 'utf8');
    writeFileSync(join(copy, 'manifest.json'), manifest.replace('{', '{"changed": true, '));
    const out = join(mkdtempSync(join(tmpdir(), 'served-')), 'bundle_v2');
    expect(() => copyBundle(copy, out, RECORDED)).toThrow('E_BUNDLE_FINGERPRINT');
    expect(existsSync(out)).toBe(false);
  });

  it('copies the runtime files the browser needs, byte for byte, and refuses when one is missing', () => {
    const from = fileURLToPath(new URL('../node_modules/onnxruntime-web/dist/', import.meta.url));
    const out = join(mkdtempSync(join(tmpdir(), 'served-')), 'ort');
    copyRuntime(from, out);
    expect(readdirSync(out).sort()).toEqual([...RUNTIME_FILES].sort());
    for (const name of RUNTIME_FILES) {
      expect(readFileSync(join(out, name)).equals(readFileSync(join(from, name)))).toBe(true);
    }
    const empty = mkdtempSync(join(tmpdir(), 'ort-'));
    const none = join(mkdtempSync(join(tmpdir(), 'served-')), 'ort');
    expect(() => copyRuntime(empty, none)).toThrow('E_RUNTIME_MISSING');
    expect(existsSync(none)).toBe(false);
  });

  it('refuses a bundle with a file missing', () => {
    const copy = mkdtempSync(join(tmpdir(), 'bundle-'));
    const out = join(mkdtempSync(join(tmpdir(), 'served-')), 'bundle_v2');
    expect(() => copyBundle(copy, out, RECORDED)).toThrow('E_BUNDLE_MISSING');
    expect(existsSync(out)).toBe(false);
  });
});
