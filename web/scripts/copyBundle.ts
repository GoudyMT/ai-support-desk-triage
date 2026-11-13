import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunAsCommand } from './exportDataset';

// The desk runs the sentence model in the browser, so the site serves its bundle.
// It must be the bundle every record measured: the copy is refused unless the
// fingerprint, worked out as the Python scorer works it out, is the recorded one.
// The copy lands in a folder git ignores, so the 23 MB file is stored once.
export const BUNDLE_FILES = ['model_quantized.onnx', 'tokenizer.json', 'heads.json', 'manifest.json'] as const;
// The base model's license and notice travel with it (Apache 2.0).
export const SERVED_FILES: readonly string[] = [...BUNDLE_FILES, 'LICENSE', 'NOTICE.md'];

// The runtime's WebAssembly build for the CPU: its loader, the worker script it starts and
// the engine. Served from the site, so the page calls no outside host.
export const RUNTIME_FILES: readonly string[] = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

/**
 * Copies the runtime files the browser loads to where the site serves them.
 *
 * Args:
 *   from: the runtime package's dist folder (the version pinned in package.json).
 *   to: the served folder; replaced whole.
 *
 * Throws:
 *   Error('E_RUNTIME_MISSING') when a file is not there; nothing is written then.
 */
export function copyRuntime(from: string, to: string): void {
  const files = RUNTIME_FILES.map((name): [string, Buffer] => {
    const path = join(from, name);
    if (!existsSync(path)) {
      throw new Error('E_RUNTIME_MISSING');
    }
    return [name, readFileSync(path)];
  });
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const [name, bytes] of files) {
    writeFileSync(join(to, name), bytes);
  }
}

const SOURCE = new URL('../../ml/models/bundle_v2/', import.meta.url);
const RECORD = new URL('../../ml/reports/bundle_v2.json', import.meta.url);
const TARGET = new URL('../public/models/bundle_v2/', import.meta.url);
const RUNTIME_SOURCE = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
const RUNTIME_TARGET = new URL('../public/models/ort/', import.meta.url);

/**
 * Reads the four files that decide the model's answers, as the repo stores them.
 *
 * Git on Windows checks a text file out with CRLF line ends; the JSON files are
 * read in their LF form, so one bundle has one fingerprint on every machine.
 *
 * Args:
 *   dir: the bundle folder.
 *
 * Returns:
 *   The bytes of each file, by name.
 *
 * Throws:
 *   Error('E_BUNDLE_MISSING') when a file is not there.
 */
export function readBundle(dir: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const name of BUNDLE_FILES) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new Error('E_BUNDLE_MISSING');
    }
    const bytes = readFileSync(path);
    files[name] = name.endsWith('.json') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : bytes;
  }
  return files;
}

/** The SHA-256, in hex, of the four files' digests joined in a fixed order (as `score_onnx.fingerprint_of`). */
export function bundleFingerprint(files: Record<string, Buffer>): string {
  const digests = BUNDLE_FILES.map((name) => createHash('sha256').update(files[name] ?? Buffer.alloc(0)).digest('hex'));
  return createHash('sha256').update(digests.join('\n'), 'ascii').digest('hex');
}

/**
 * Copies the bundle and its notices to where the site serves them, after the fingerprint check.
 *
 * Args:
 *   from: the bundle folder.
 *   to: the served folder; replaced whole.
 *   expected: the recorded fingerprint.
 *
 * Throws:
 *   Error('E_BUNDLE_MISSING') for a missing file; Error('E_BUNDLE_FINGERPRINT')
 *   when the bundle is not the recorded one. Nothing is written in either case.
 */
export function copyBundle(from: string, to: string, expected: string): void {
  const files = readBundle(from);
  if (bundleFingerprint(files) !== expected) {
    throw new Error('E_BUNDLE_FINGERPRINT');
  }
  const notices = SERVED_FILES.filter((name) => !(name in files)).map((name): [string, Buffer] => {
    const path = join(from, name);
    if (!existsSync(path)) {
      throw new Error('E_BUNDLE_MISSING');
    }
    return [name, readFileSync(path)];
  });
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const [name, bytes] of [...Object.entries(files), ...notices]) {
    writeFileSync(join(to, name), bytes);
  }
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const expected = (JSON.parse(readFileSync(RECORD, 'utf8')) as { fingerprint: string }).fingerprint;
  copyBundle(fileURLToPath(SOURCE), fileURLToPath(TARGET), expected);
  console.log(`copied the bundle (${expected.slice(0, 12)}...) to ${fileURLToPath(TARGET)}`);
  copyRuntime(fileURLToPath(RUNTIME_SOURCE), fileURLToPath(RUNTIME_TARGET));
  console.log(`copied the runtime to ${fileURLToPath(RUNTIME_TARGET)}`);
}
