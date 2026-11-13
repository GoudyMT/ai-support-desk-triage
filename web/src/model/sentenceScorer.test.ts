import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { WEB_RECORD, bundleFiles, judgedRows, rowsDigest, type AnswerRecord, type SetName } from '../../scripts/recordWebAnswers';
import { CATEGORIES, PRIORITIES } from '../domain/labels';
import cases from './bundle.cases.json';
import { fingerprintOf, loadSentenceModel, sentenceModelFrom, type SentenceFiles } from './sentenceScorer';

// The browser's sentence model must give the answers recorded for the browser's
// own engine (`ml/reports/bundle_v2_answers_web.json`, made by
// `scripts/recordWebAnswers.ts`), one ticket at a time as the desk scores, or a
// change to the tokenizer, the scoring or the engine's version would change what
// the desk shows unseen. Each set is rebuilt here and proved to be the rows every
// record was made on (same SHA-256) before it is scored. The limit is the owner's
// (2026-11-11): at most 1 differing ticket per hand-written set and 20 of the
// 4,000 desk tickets. The Python record of the same tickets one at a time
// (`bundle_v2_answers_single.json`) differs from the web engine's on 23 desk
// tickets, all near ties (measured 2026-11-13); the owner chose this record.

const RECORD = JSON.parse(readFileSync(new URL('../../../ml/reports/bundle_v2.json', import.meta.url), 'utf8')) as { fingerprint: string };
const ANSWERS = JSON.parse(readFileSync(WEB_RECORD, 'utf8')) as AnswerRecord;
const PYTHON_SINGLE = JSON.parse(readFileSync(new URL('../../../ml/reports/bundle_v2_answers_single.json', import.meta.url), 'utf8')) as AnswerRecord;
const MOST_DIFFERING: Record<SetName, number> = { handwritten: 1, fresh: 1, desk: 20 };
// The two runtimes agree to 1e-8 on most texts; where the 8-bit model rounds an
// activation on a tie they part by up to 0.0022 (measured on these cases,
// 2026-11-13). Twice that is the gap allowed.
const MAX_PROBABILITY_GAP = 0.005;
const CLASSES = { category: CATEGORIES, priority: PRIORITIES };
// Scoring 4,000 tickets on one CPU thread takes about a minute.
const SCORING_TIMEOUT_MS = 300_000;

// One thread: a test run shares the machine.
ort.env.wasm.numThreads = 1;

describe('the sentence model in the browser', () => {
  it('works out the fingerprint the Python scorer recorded, whatever the line ends', async () => {
    const files = bundleFiles();
    expect(await fingerprintOf(files)).toBe(RECORD.fingerprint);
    expect(ANSWERS.bundle_fingerprint).toBe(RECORD.fingerprint);
    const crlf = new TextEncoder().encode(new TextDecoder().decode(files['heads.json']).replace(/\r?\n/g, '\r\n'));
    expect(await fingerprintOf({ ...files, 'heads.json': crlf })).toBe(RECORD.fingerprint);
  });

  it.each(Object.keys(MOST_DIFFERING) as SetName[])(
    'answers the %s set as recorded for the web engine',
    async (set) => {
      const recorded = ANSWERS.sets[set];
      const rows = judgedRows(set);
      // The same tickets every record was made on.
      expect(rowsDigest(rows)).toBe(recorded.rows_sha256);
      expect(recorded.rows_sha256).toBe(PYTHON_SINGLE.sets[set].rows_sha256);
      const model = await sentenceModelFrom(bundleFiles(), RECORD.fingerprint, ort, CLASSES);
      const differing: string[] = [];
      for (const [at, row] of rows.entries()) {
        const [id, category, priority] = recorded.answers[at] ?? [];
        expect(row.id).toBe(id);
        const got = await model.predict(row.maskedText);
        if (got.category !== category || got.priority !== priority) {
          differing.push(row.id);
        }
      }
      expect(rows.length).toBe(recorded.answers.length);
      expect(differing.length, differing.join(', ')).toBeLessThanOrEqual(MOST_DIFFERING[set]);
    },
    SCORING_TIMEOUT_MS,
  );

  it('gives the answers and probabilities the Python scorer gives one ticket at a time', async () => {
    const model = await sentenceModelFrom(bundleFiles(), RECORD.fingerprint, ort, CLASSES);
    for (const item of cases) {
      const got = await model.predict(item.text);
      expect([item.name, got.category, got.priority]).toEqual([item.name, item.category, item.priority]);
      expect(Math.abs(got.categoryProbability - item.categoryProbability)).toBeLessThan(MAX_PROBABILITY_GAP);
      expect(Math.abs(got.priorityProbability - item.priorityProbability)).toBeLessThan(MAX_PROBABILITY_GAP);
    }
  });

  it('refuses a bundle that is not the recorded one, and one it cannot read', async () => {
    const files = bundleFiles();
    const cut = files['model_quantized.onnx'].slice(0, 1000);
    await expect(sentenceModelFrom({ ...files, 'model_quantized.onnx': cut }, RECORD.fingerprint, ort, CLASSES)).rejects.toThrow('E_SENTENCE_LOAD');
    // Readable, but not the bundle any record measured.
    const changed = { ...files, 'manifest.json': new TextEncoder().encode('{"max_length": 128}\n') };
    await expect(sentenceModelFrom(changed, RECORD.fingerprint, ort, CLASSES)).rejects.toThrow('E_SENTENCE_LOAD');
    const badHeads = { ...files, 'heads.json': new TextEncoder().encode('{"category": {}}') };
    await expect(sentenceModelFrom(badHeads, await fingerprintOf(badHeads), ort, CLASSES)).rejects.toThrow('E_SENTENCE_SHAPE');
  });

  it('says it could not load when a file is missing or the network fails', async () => {
    const files = bundleFiles();
    const served = (missing: string): typeof fetch =>
      (async (url: string | URL | Request) => {
        const name = String(url).split('/').at(-1) ?? '';
        return name === missing ? new Response('', { status: 404 }) : new Response(files[name as keyof SentenceFiles] as Uint8Array<ArrayBuffer>);
      }) as typeof fetch;
    await expect(loadSentenceModel('models/bundle_v2/', RECORD.fingerprint, ort, CLASSES, served('heads.json'))).rejects.toThrow('E_SENTENCE_LOAD');
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(loadSentenceModel('models/bundle_v2/', RECORD.fingerprint, ort, CLASSES, offline)).rejects.toThrow('E_SENTENCE_LOAD');
    const model = await loadSentenceModel('models/bundle_v2/', RECORD.fingerprint, ort, CLASSES, served('none'));
    expect((await model.predict('I was charged twice for my plan this month.')).category).toBe('Billing');
  });
});
