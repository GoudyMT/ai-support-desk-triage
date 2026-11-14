import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CATEGORIES, PRIORITIES } from '../src/domain/labels';
import { BUILT_IN_WORDING, generateTicketDetail } from '../src/generator/generate';
import type { Template } from '../src/generator/templates';
import type { Wording } from '../src/generator/wording';
import { loadModel, score } from '../src/model/scorer';
import type { Predict } from '../src/pipeline/run';
import { tablePredict } from '../src/pipeline/tableScorer';
import { maskText } from '../src/privacy/mask';
import { BLIND_WORDING } from './blind/blindFrames';
import { BLIND_SEED, buildBlind } from './exportBlind';
import { isRunAsCommand } from './exportDataset';
import { measureTwoPredictors, type TwoModelResult } from './measureTwoModels';
import { parseRows, type LabeledRow } from './measurePipeline';

// The one reading of the blind set (Part 2 design 3.4): every ladder row scored on
// the 2,000 tickets no model trained or was tuned on, once, with and without the
// tickets built from the 6 blind templates that share many 4-word runs with the
// built-in training wording. The answers come from `ml/triage_v2/blind_answers.py`;
// this script works the reading out from them, and CI works it out again.

const BLIND_FILE = new URL('../../ml/data/blind.jsonl', import.meta.url);
const BLIND_SHA = new URL('../../ml/data/blind.sha256', import.meta.url);
const ANSWERS_FILE = new URL('../../ml/reports/blind_answers.json', import.meta.url);
const READING_FILE = new URL('../../ml/reports/blind_reading.json', import.meta.url);
const SHIPPED_MODEL = new URL('../src/model/model.json', import.meta.url);
const RUN_LENGTH = 4;
// The Part 1 check (plan notes, 2026-11-10): a blind template is a near match when more than this share of its 4-word
// runs, slots removed, is found in the built-in training templates.
const NEAR_SHARE = 0.3;
// The release bar (design 2026-11-10, Revision 1, section 9), written before the reading: on the tickets sent to a
// person under the two-model rule, the suggestion is right on department at least this many points more often than the
// word model's answer on the same tickets, and none of the four counts is above the word model's alone.
export const BAR_POINTS = 10;
const PERCENT = 100;

export interface AnswersFile {
  blind_sha256: string;
  models: Record<string, { fingerprint: string; answers: [string, string, string][] }>;
}

export interface ModelReading {
  tickets: number;
  // The model alone on every ticket: right on department and on priority.
  alone: { category: number; priority: number };
  // The word model as the gate and this model's answer as the suggestion.
  twoModel: TwoModelResult;
}

export interface BlindReading {
  blind_sha256: string;
  near_match_templates: number;
  near_match_tickets: number;
  word: { all: { category: number; priority: number }; without: { category: number; priority: number } };
  models: Record<string, { fingerprint: string; all: ModelReading; without: ModelReading }>;
  bar: { points: number; gain_points: number; counts_held: boolean; met: boolean };
}

function runs(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/\{\w+\}/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  return Array.from({ length: Math.max(words.length - RUN_LENGTH + 1, 0) }, (_, start) => words.slice(start, start + RUN_LENGTH).join(' '));
}

function templatesOf(wording: Wording): Template[] {
  return [
    ...CATEGORIES.flatMap((category) => wording.templates[category]),
    ...CATEGORIES.flatMap((category) => wording.trapTemplates[category]),
    ...wording.vagueTemplates,
    ...wording.politeSecurityTemplates,
  ];
}

/**
 * The blind templates whose 4-word runs are more than NEAR_SHARE inside the built-in training wording.
 *
 * Returns:
 *   Their texts.
 */
export function nearMatchTemplates(blind: Wording = BLIND_WORDING, builtIn: Wording = BUILT_IN_WORDING): Set<string> {
  const trained = new Set(templatesOf(builtIn).flatMap((template) => runs(template.text)));
  return new Set(
    templatesOf(blind)
      .filter((template) => {
        const own = runs(template.text);
        return own.length > 0 && own.filter((run) => trained.has(run)).length / own.length > NEAR_SHARE;
      })
      .map((template) => template.text),
  );
}

/** The ids of the blind tickets built from a near-match template, rebuilt from the blind set's own seed. */
export function nearMatchIds(near: ReadonlySet<string>): Set<string> {
  return new Set(
    buildBlind()
      .filter((ticket) => generateTicketDetail(BLIND_SEED, ticket.index, 'all', BLIND_WORDING).templates.some((template) => near.has(template.text)))
      .map((ticket) => ticket.id),
  );
}

function share(right: number, of: number): number {
  return of === 0 ? 0 : right / of;
}

function aloneRight(rows: readonly LabeledRow[], predict: Predict): { category: number; priority: number } {
  let category = 0;
  let priority = 0;
  for (const row of rows) {
    // A model reads the masked text, as the pipeline gives it.
    const masked = maskText(row.text).text;
    category += predict('category', masked, row.id).label === row.label.category ? 1 : 0;
    priority += predict('priority', masked, row.id).label === row.label.priority ? 1 : 0;
  }
  return { category, priority };
}

function readingOf(rows: readonly LabeledRow[], gate: Predict, answer: Predict): ModelReading {
  return { tickets: rows.length, alone: aloneRight(rows, answer), twoModel: measureTwoPredictors(rows, gate, answer) };
}

function answerPredict(answers: readonly [string, string, string][]): Predict {
  const whole = (classes: readonly string[], choice: string): Record<string, number> => {
    if (!classes.includes(choice)) {
      throw new Error('E_ANSWER_SHAPE');
    }
    return Object.fromEntries(classes.map((name) => [name, name === choice ? 1 : 0]));
  };
  return tablePredict(answers.map(([id, category, priority]) => ({ id, category_probs: whole(CATEGORIES, category), priority_probs: whole(PRIORITIES, priority) })));
}

/**
 * Works the blind reading out from the recorded answers.
 *
 * Args:
 *   rows: the blind tickets, in file order.
 *   blindSha: the frozen file's SHA-256.
 *   answers: every model's recorded answers on them.
 *   gate: the shipped word model's scorer.
 *   near: the ids of the tickets built from a near-match template.
 *   nearTemplates: how many templates those are.
 *
 * Returns:
 *   The reading and the release bar's verdict on the sentence model.
 *
 * Throws:
 *   Error('E_BLIND_CHANGED') when the answers were made on another blind file;
 *   Error('E_ANSWER_SET') when a model's answers are not one per ticket, in order.
 */
export function readBlind(rows: readonly LabeledRow[], blindSha: string, answers: AnswersFile, gate: Predict, near: ReadonlySet<string>, nearTemplates: number): BlindReading {
  if (answers.blind_sha256 !== blindSha) {
    throw new Error('E_BLIND_CHANGED');
  }
  const without = rows.filter((row) => !near.has(row.id));
  const models: BlindReading['models'] = {};
  for (const [name, model] of Object.entries(answers.models)) {
    if (model.answers.length !== rows.length || model.answers.some(([id], at) => id !== rows[at]?.id)) {
      throw new Error('E_ANSWER_SET');
    }
    const predict = answerPredict(model.answers);
    models[name] = { fingerprint: model.fingerprint, all: readingOf(rows, gate, predict), without: readingOf(without, gate, predict) };
  }
  const sentence = models['sentence']?.all.twoModel;
  if (sentence === undefined) {
    throw new Error('E_ANSWER_SET');
  }
  const gain = (share(sentence.suggestion.answer.category, sentence.reviewed) - share(sentence.suggestion.gate.category, sentence.reviewed)) * PERCENT;
  const held = (['highRiskMissed', 'highUrgentOutLow', 'silentCategory', 'silentPriority'] as const).every((count) => sentence.both[count] <= sentence.today[count]);
  return {
    blind_sha256: blindSha,
    near_match_templates: nearTemplates,
    near_match_tickets: near.size,
    word: { all: aloneRight(rows, gate), without: aloneRight(without, gate) },
    models,
    bar: { points: BAR_POINTS, gain_points: Math.round(gain * PERCENT) / PERCENT, counts_held: held, met: gain >= BAR_POINTS && held },
  };
}

function build(): BlindReading {
  // Git on Windows checks the file out with CRLF line ends; its fingerprint is of the LF form it was written in.
  const content = readFileSync(BLIND_FILE, 'utf8').replace(/\r\n/g, '\n');
  const sha = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
  if (sha !== readFileSync(BLIND_SHA, 'utf8').trim()) {
    throw new Error('E_BLIND_CHANGED');
  }
  const model = loadModel(JSON.parse(readFileSync(SHIPPED_MODEL, 'utf8')));
  const near = nearMatchTemplates();
  return readBlind(
    parseRows(content),
    sha,
    JSON.parse(readFileSync(ANSWERS_FILE, 'utf8')) as AnswersFile,
    (head, maskedText) => score(model, head, maskedText),
    nearMatchIds(near),
    near.size,
  );
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const built = build();
  if (process.argv.includes('--write')) {
    writeFileSync(READING_FILE, `${JSON.stringify(built, null, 1)}\n`, 'utf8');
    console.log(`    bar met: ${built.bar.met} (suggestion gain ${built.bar.gain_points} points, counts held: ${built.bar.counts_held})`);
  } else {
    const recorded = readFileSync(READING_FILE, 'utf8').replace(/\r\n/g, '\n');
    if (recorded !== `${JSON.stringify(built, null, 1)}\n`) {
      console.log('E_READING_DIFFERS: the blind reading in the repo is not the one its answers give');
      process.exitCode = 1;
    } else {
      console.log('    blind reading matches its answers');
    }
  }
}
