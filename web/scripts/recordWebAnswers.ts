import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { CATEGORIES, PRIORITIES } from '../src/domain/labels';
import { SENTENCE_FILES, sentenceModelFrom, type SentenceFiles, type SentenceModel } from '../src/model/sentenceScorer';
import { FRESH_SOURCE, handwrittenToJsonl, isRunAsCommand, loadHandwritten, toJsonl } from './exportDataset';
import { buildV2Desk } from './exportV2';

// The answers the browser's own engine (onnxruntime-web, the files the site
// serves) gives on every ticket of the judged sets, one ticket at a time as the
// desk scores. The browser is held to this record: the Python engine rounds the
// 8-bit model a little differently, and on 23 of the 4,000 desk tickets, every
// one a near tie, the two engines answer differently (measured 2026-11-13; the
// owner chose this record, "Let's go with A"). Every published count stays the
// Python record's.
//
// Run from the project root: `npm --prefix web run record-web-answers`.

const BUNDLE = new URL('../../ml/models/bundle_v2/', import.meta.url);
const REPORT = new URL('../../ml/reports/bundle_v2.json', import.meta.url);
export const WEB_RECORD = new URL('../../ml/reports/bundle_v2_answers_web.json', import.meta.url);
const RUNTIME_PACKAGE = new URL('../node_modules/onnxruntime-web/package.json', import.meta.url);
const DESK_TICKETS = 4_000;
const LAST_ASCII = 0x7f;
const HEX_DIGITS = 4;

export const SET_NAMES = ['desk', 'handwritten', 'fresh'] as const;
export type SetName = (typeof SET_NAMES)[number];
// The file each set is written to by the exports, as the Python record names it.
const SET_FILES: Record<SetName, string> = { desk: 'v2_desk.jsonl', handwritten: 'handwritten.jsonl', fresh: 'v2_handwritten_fresh.jsonl' };

export interface JudgedRow {
  id: string;
  maskedText: string;
  category: string;
  priority: string;
  mustReview: boolean;
}

export interface AnswerRecord {
  bundle_fingerprint: string;
  sets: Record<SetName, { file: string; rows_sha256: string; answers: [string, string, string][] }>;
}

/** Builds a judged set's rows as the exports write them. */
export function judgedRows(set: SetName): JudgedRow[] {
  const jsonl =
    set === 'desk'
      ? toJsonl(buildV2Desk(DESK_TICKETS), null)
      : handwrittenToJsonl(set === 'handwritten' ? loadHandwritten() : loadHandwritten(FRESH_SOURCE));
  return jsonl
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as JudgedRow);
}

/**
 * The digest `ml/triage_v2/bundle_answers.py` records for a set: Python's json.dumps of
 * [id, maskedText, category, priority, mustReview] per row (", " between items, every
 * non-ASCII character escaped), rows joined by newlines.
 */
export function rowsDigest(rows: readonly JudgedRow[]): string {
  const asciiJson = (value: unknown): string =>
    Array.from(JSON.stringify(value).split(''), (unit) => {
      const code = unit.charCodeAt(0);
      return code > LAST_ASCII ? `\\u${code.toString(16).padStart(HEX_DIGITS, '0')}` : unit;
    }).join('');
  const lines = rows.map((row) => `[${[row.id, row.maskedText, row.category, row.priority, row.mustReview].map(asciiJson).join(', ')}]`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function bundleFiles(): SentenceFiles {
  return Object.fromEntries(SENTENCE_FILES.map((name) => [name, new Uint8Array(readFileSync(new URL(name, BUNDLE)))])) as SentenceFiles;
}

export function recordedFingerprint(): string {
  return (JSON.parse(readFileSync(REPORT, 'utf8')) as { fingerprint: string }).fingerprint;
}

/** Loads the bundle on the web engine, on one thread, as the desk runs it. */
export function webModel(): Promise<SentenceModel> {
  ort.env.wasm.numThreads = 1;
  return sentenceModelFrom(bundleFiles(), recordedFingerprint(), ort, { category: CATEGORIES, priority: PRIORITIES });
}

async function buildRecord(): Promise<AnswerRecord> {
  const model = await webModel();
  const sets = {} as AnswerRecord['sets'];
  for (const set of SET_NAMES) {
    const rows = judgedRows(set);
    const answers: [string, string, string][] = [];
    for (const row of rows) {
      const got = await model.predict(row.maskedText);
      answers.push([row.id, got.category, got.priority]);
    }
    sets[set] = { file: SET_FILES[set], rows_sha256: rowsDigest(rows), answers };
    console.log(`    ${set}: ${answers.length.toLocaleString('en-US')} tickets`);
  }
  return { bundle_fingerprint: recordedFingerprint(), sets };
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const runtime = (JSON.parse(readFileSync(RUNTIME_PACKAGE, 'utf8')) as { version: string }).version;
  const record = await buildRecord();
  writeFileSync(WEB_RECORD, `${JSON.stringify({ ...record, runtime: `onnxruntime-web ${runtime}`, batch_size: 1 })}\n`, 'utf8');
  console.log(`    Saved: ${WEB_RECORD.pathname}`);
}
