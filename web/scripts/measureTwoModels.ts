import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, ROUTES } from '../src/domain/labels';
import { loadModel, score } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith, type Predict } from '../src/pipeline/run';
import { tablePredict, type SavedAnswer } from '../src/pipeline/tableScorer';
import type { ReviewDecision, ReviewInput, TicketTrail } from '../src/pipeline/types';
import { isRunAsCommand } from './exportDataset';
import type { AnswersResult } from './measureAnswers';
import { parseRows, type LabeledRow } from './measurePipeline';

// Measures two models working together. The gate model decides, with the rules
// and the confidence floor, whether a ticket may leave unchecked, exactly as
// the desk does today. The answer model gives the answer a person is shown. A
// ticket leaves unchecked only when the gate lets it and both models give the
// same department and priority, so an unchecked ticket always carries the gate
// model's answer. The tickets that leave unchecked are then a part of the ones
// the gate alone lets out, with the same answers, so none of the four error
// counts (high-risk missed, High/Urgent out as low, wrong department, wrong
// priority) can be higher than the gate model's alone. The count of tickets
// sent to a person can only be the same or higher.

const LOW_SIDE = new Set(['Low', 'Medium']);
const HIGH_SIDE = new Set(['High', 'Urgent']);
// The answer model is only compared with the gate, never used as a gate, so its
// own confidence must not flag anything.
const NO_FLOOR = 0;

export interface SuggestionRight {
  category: number;
  priority: number;
  both: number;
}

export interface TwoModelResult {
  // The gate model alone, as the desk works today.
  today: AnswersResult;
  // The gate model and the answer model together.
  both: AnswersResult;
  // Tickets a person sees under the two-model rule, and on how many of them
  // each model's own answer was already right.
  reviewed: number;
  suggestion: { gate: SuggestionRight; answer: SuggestionRight };
}

const AGREEING_REVIEWER = {
  decide(input: ReviewInput): ReviewDecision {
    return { ...input.suggestion, route: ROUTES[input.suggestion.category], reason: 'reviewed' };
  },
};

function emptyResult(tickets: number): AnswersResult {
  return { tickets, flagged: 0, mustReview: 0, highRiskMissed: 0, highUrgentOutLow: 0, silentCategory: 0, silentPriority: 0 };
}

function countUnchecked(result: AnswersResult, row: LabeledRow, trail: TicketTrail): void {
  result.highRiskMissed += row.label.mustReview ? 1 : 0;
  result.highUrgentOutLow += HIGH_SIDE.has(row.label.priority) && LOW_SIDE.has(trail.final.priority) ? 1 : 0;
  result.silentCategory += trail.final.category !== row.label.category ? 1 : 0;
  result.silentPriority += trail.final.priority !== row.label.priority ? 1 : 0;
}

/**
 * Counts what leaves unchecked under the gate model alone and under the two-model rule.
 *
 * @param rows The tickets with their true labels.
 * @param gateAnswers The gate model's saved answer for every ticket.
 * @param answerAnswers The answer model's saved answer for every ticket.
 * @param floor The gate's confidence floor.
 * @param secondCheckOn Whether the gate's second check may clear a flag.
 * @returns Both sets of counts and how often each model's own answer was right on the reviewed tickets.
 * @throws Error('E_ANSWER_MISSING') when either model has no answer for a ticket.
 */
export function measureTwoModels(
  rows: readonly LabeledRow[],
  gateAnswers: readonly SavedAnswer[],
  answerAnswers: readonly SavedAnswer[],
  floor: number = CONFIDENCE_FLOOR,
  secondCheckOn: boolean = SECOND_CHECK_ON,
): TwoModelResult {
  // A table with more answers than tickets was made on another set of tickets.
  // One with fewer, or with other ids, stops at the first ticket it lacks.
  if (gateAnswers.length !== rows.length || answerAnswers.length !== rows.length) {
    throw new Error('E_ANSWER_SET');
  }
  return measureTwoPredictors(rows, tablePredict(gateAnswers), tablePredict(answerAnswers), floor, secondCheckOn);
}

/**
 * The same count with each model given as a scorer, so the gate can be a model that runs here.
 *
 * @param rows The tickets with their true labels.
 * @param gatePredict The gate model's scorer.
 * @param answerPredict The answer model's scorer.
 * @param floor The gate's confidence floor.
 * @param secondCheckOn Whether the gate's second check may clear a flag.
 * @returns Both sets of counts and how often each model's own answer was right on the reviewed tickets.
 */
export function measureTwoPredictors(
  rows: readonly LabeledRow[],
  gatePredict: Predict,
  answerPredict: Predict,
  floor: number = CONFIDENCE_FLOOR,
  secondCheckOn: boolean = SECOND_CHECK_ON,
): TwoModelResult {
  const base = { reviewer: AGREEING_REVIEWER, secondCheckOn, now: () => 0 };
  const result: TwoModelResult = {
    today: emptyResult(rows.length),
    both: emptyResult(rows.length),
    reviewed: 0,
    suggestion: { gate: { category: 0, priority: 0, both: 0 }, answer: { category: 0, priority: 0, both: 0 } },
  };
  for (const row of rows) {
    const gate = runTicketWith(row.text, row.id, gatePredict, { ...base, floor });
    const answer = runTicketWith(row.text, row.id, answerPredict, { ...base, floor: NO_FLOOR });
    const must = row.label.mustReview ? 1 : 0;
    result.today.mustReview += must;
    result.both.mustReview += must;

    if (gate.guard.flagged) {
      result.today.flagged += 1;
    } else {
      countUnchecked(result.today, row, gate);
    }

    const agree = !answer.guard.flagged && answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
    if (!gate.guard.flagged && agree) {
      countUnchecked(result.both, row, gate);
      continue;
    }
    result.both.flagged += 1;
    result.reviewed += 1;
    for (const [who, trail] of [['gate', gate], ['answer', answer]] as const) {
      const categoryRight = trail.category.label === row.label.category;
      const priorityRight = trail.guard.priority === row.label.priority;
      result.suggestion[who].category += categoryRight ? 1 : 0;
      result.suggestion[who].priority += priorityRight ? 1 : 0;
      result.suggestion[who].both += categoryRight && priorityRight ? 1 : 0;
    }
  }
  return result;
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Reads the gate's confidence floor from the command line.
 *
 * @param value The text after `--floor`, or undefined for the desk's own floor.
 * @returns The floor.
 * @throws Error('E_BAD_FLOOR') for anything but a number from 0 to 1: a mistyped
 *   floor compares false with every confidence and would switch the floor off.
 */
export function parseFloor(value: string | undefined): number {
  const floor = value === undefined ? CONFIDENCE_FLOOR : Number(value);
  if (value === '' || !Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new Error('E_BAD_FLOOR');
  }
  return floor;
}

// The bundle's recorded answers (`ml/reports/bundle_v2_answers.json`): for each
// judged set its file and, per ticket, the id and the chosen department and priority.
export interface AnswersRecord {
  bundle_fingerprint: string;
  sets: Record<string, { file: string; answers: readonly (readonly [string, string, string])[] }>;
}

export interface SetsReport {
  gate: string;
  answer: { bundle_fingerprint: string };
  floor: number;
  how: string;
  sets: Record<string, TwoModelResult & { file: string }>;
}

const SET_LABELS: Record<string, string> = { desk: 'desk-only wording', handwritten: 'hand-written (seen)', fresh: 'hand-written (fresh)' };
const SHIPPED_GATE = 'web/src/model/model.json (the shipped word model, unchanged)';
const SETS_HOW = 'npm --prefix web run measure-two-models -- --write-sets (worked out again by CI with --check-sets)';

// The answer model is compared with the gate by its choice alone, never by how
// sure it is, so a recorded choice is a whole answer: all probability on it.
function chosenOnly(classes: readonly string[], choice: string): Record<string, number> {
  if (!classes.includes(choice)) {
    throw new Error('E_ANSWER_SHAPE');
  }
  return Object.fromEntries(classes.map((name) => [name, name === choice ? 1 : 0]));
}

/**
 * Works out the two-model counts of every judged set from the bundle's recorded answers.
 *
 * @param record The bundle's recorded answers.
 * @param readRows Reads a set's tickets by file name.
 * @param gatePredict The gate model's scorer.
 * @param floor The gate's confidence floor.
 * @returns The report, carrying the fingerprint of the bundle the answers came from.
 * @throws Error('E_ANSWER_SET') when a set's answers are not one per ticket, in the tickets' order.
 */
export function measureSets(
  record: AnswersRecord,
  readRows: (file: string) => LabeledRow[],
  gatePredict: Predict,
  floor: number = CONFIDENCE_FLOOR,
): SetsReport {
  const sets: SetsReport['sets'] = {};
  for (const [name, { file, answers }] of Object.entries(record.sets)) {
    const rows = readRows(file);
    if (answers.length !== rows.length || answers.some(([id], index) => id !== rows[index]?.id)) {
      throw new Error('E_ANSWER_SET');
    }
    const saved = answers.map(([id, category, priority]) => ({
      id,
      category_probs: chosenOnly(CATEGORIES, category),
      priority_probs: chosenOnly(PRIORITIES, priority),
    }));
    sets[SET_LABELS[name] ?? name] = { file, ...measureTwoPredictors(rows, gatePredict, tablePredict(saved), floor) };
  }
  return { gate: SHIPPED_GATE, answer: { bundle_fingerprint: record.bundle_fingerprint }, floor, how: SETS_HOW, sets };
}

/**
 * Names the parts of a recorded report that differ from the one worked out now.
 *
 * @param recorded The report in the repo.
 * @param built The report worked out from the recorded answers.
 * @returns The names of the differing sets or fields; empty when the record is true.
 */
export function reportDifferences(recorded: SetsReport, built: SetsReport): string[] {
  const names = new Set([...Object.keys(recorded.sets ?? {}), ...Object.keys(built.sets)]);
  const differing = [...names].filter((name) => JSON.stringify(recorded.sets?.[name]) !== JSON.stringify(built.sets[name]));
  if (recorded.answer?.bundle_fingerprint !== built.answer.bundle_fingerprint) {
    differing.push('bundle_fingerprint');
  }
  if (recorded.floor !== built.floor) {
    differing.push('floor');
  }
  return differing;
}

// The six tuning files: each leaves two folds out and is scored on both.
const FOLD_PAIRS: readonly (readonly [number, number])[] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

export interface RoundRecord extends TwoModelResult {
  train: string;
  fold: number;
}

export interface RoundsInput {
  // Where the practice run left its answer files, named <key>_tune_<a>_<b>_answers_fold_<fold>.json.
  answersDir: string;
  gateKey: string;
  answerKey: string;
  // Where the held-out ticket files are, and their name before _<fold>.jsonl.
  dataDir: string;
  heldoutPrefix: string;
}

/**
 * Measures the two-model rule on every practice round whose files are present.
 *
 * @param input Where the answer files and the held-out tickets are, and which two runs to pair.
 * @param floor The gate's confidence floor.
 * @returns One record per round, in the order of the tuning files.
 * @throws Whatever reading a missing file throws: a round is never skipped silently.
 */
export function measureRounds(input: RoundsInput, floor: number = CONFIDENCE_FLOOR): RoundRecord[] {
  const read = (key: string, a: number, b: number, fold: number): SavedAnswer[] =>
    JSON.parse(readFileSync(join(input.answersDir, `${key}_tune_${a}_${b}_answers_fold_${fold}.json`), 'utf8')) as SavedAnswer[];
  const records: RoundRecord[] = [];
  for (const [a, b] of FOLD_PAIRS) {
    for (const fold of [a, b]) {
      const rows = parseRows(readFileSync(join(input.dataDir, `${input.heldoutPrefix}_${fold}.jsonl`), 'utf8'));
      const result = measureTwoModels(rows, read(input.gateKey, a, b, fold), read(input.answerKey, a, b, fold), floor);
      records.push({ train: `${a}_${b}`, fold, ...result });
    }
  }
  return records;
}

// A scorer for a word model file as the page loads it.
function modelPredict(path: string): Predict {
  const model = loadModel(JSON.parse(readFileSync(path, 'utf8')));
  return (head, maskedText) => score(model, head, maskedText);
}

// The practice answer files are not in the repo, so CI cannot work this report
// out again. The practice rounds were also read many times while the design was
// chosen; the judged sets and the blind set are the unbiased ones.
const ROUNDS_NOTE =
  'Recorded once on the owner\'s PC from practice answer files that are not in the repo. CI checks its shape and its promise (test_two_model_report.py) but does not work the counts out again. The practice rounds were read many times while the design was chosen.';
const ANSWERS_RECORD = new URL('../../ml/reports/bundle_v2_answers.json', import.meta.url);
const SETS_REPORT = new URL('../../ml/reports/two_model_sets.json', import.meta.url);
const GENERATED_DIR = new URL('../../ml/data/generated/', import.meta.url);
const SHIPPED_MODEL = new URL('../src/model/model.json', import.meta.url);

// Works the judged sets' report out from the recorded answers, then writes it
// or compares it with the one in the repo.
function recordSets(write: boolean): number {
  const record = JSON.parse(readFileSync(ANSWERS_RECORD, 'utf8')) as AnswersRecord;
  const readRows = (file: string): LabeledRow[] => parseRows(readFileSync(new URL(file, GENERATED_DIR), 'utf8'));
  const built = measureSets(record, readRows, modelPredict(fileURLToPath(SHIPPED_MODEL)));
  if (write) {
    writeFileSync(SETS_REPORT, `${JSON.stringify(built, null, 1)}\n`, 'utf8');
    console.log(`wrote ${fileURLToPath(SETS_REPORT)} (${Object.keys(built.sets).length} sets)`);
    return 0;
  }
  const differing = reportDifferences(JSON.parse(readFileSync(SETS_REPORT, 'utf8')) as SetsReport, built);
  console.log(differing.length === 0 ? 'PASS two-model report matches the recorded answers' : `FAIL two-model report differs: ${differing.join(', ')}`);
  return differing.length === 0 ? 0 : 1;
}

function recordRounds(args: readonly string[], out: string): number {
  const needed = ['--answers-dir', '--gate-key', '--answer-key', '--data-dir', '--heldout-prefix'].map((name) => argValue(args, name));
  const [answersDir, gateKey, answerKey, dataDir, heldoutPrefix] = needed;
  if (answersDir === undefined || gateKey === undefined || answerKey === undefined || dataDir === undefined || heldoutPrefix === undefined) {
    console.log('usage: measureTwoModels --out <report.json> --answers-dir <dir> --gate-key <run> --answer-key <run> --data-dir <dir> --heldout-prefix <name>');
    return 2;
  }
  const floor = parseFloor(argValue(args, '--floor'));
  const rounds = measureRounds({ answersDir, gateKey, answerKey, dataDir, heldoutPrefix }, floor);
  writeFileSync(out, `${JSON.stringify({ gate: gateKey, answer: answerKey, heldout: heldoutPrefix, floor, note: ROUNDS_NOTE, rounds }, null, 1)}\n`, 'utf8');
  console.log(`wrote ${out} (${rounds.length} rounds)`);
  return 0;
}

function main(args: readonly string[]): number {
  if (args.includes('--write-sets') || args.includes('--check-sets')) {
    return recordSets(args.includes('--write-sets'));
  }
  const out = argValue(args, '--out');
  if (out !== undefined) {
    return recordRounds(args, out);
  }
  const rowsPath = argValue(args, '--rows');
  const gatePath = argValue(args, '--gate');
  const gateModelPath = argValue(args, '--gate-model');
  const answerPath = argValue(args, '--answer');
  if (rowsPath === undefined || answerPath === undefined || (gatePath === undefined) === (gateModelPath === undefined)) {
    console.log('usage: measureTwoModels --rows <tickets.jsonl> (--gate <answers.json> | --gate-model <model.json>) --answer <answers.json> [--floor <0..1>]');
    return 2;
  }
  const floor = parseFloor(argValue(args, '--floor'));
  const rows = parseRows(readFileSync(rowsPath, 'utf8'));
  const read = (path: string): SavedAnswer[] => JSON.parse(readFileSync(path, 'utf8')) as SavedAnswer[];
  const gatePredict = gateModelPath === undefined ? tablePredict(read(gatePath ?? '')) : modelPredict(gateModelPath);
  console.log(JSON.stringify(measureTwoPredictors(rows, gatePredict, tablePredict(read(answerPath)), floor)));
  return 0;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
