import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, type Category, type Priority, type TicketLabel } from '../src/domain/labels';
import { FOLDS } from '../src/generator/templates';
import type { HistoryRow } from '../src/history/view';
import { loadModel, type Model } from '../src/model/scorer';
import { computeMetrics } from '../src/pipeline/metrics';
import { createSimulatedReviewer } from '../src/pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTickets } from '../src/pipeline/run';
import { createDeskSchedule } from '../src/run/clock';
import { createRun } from '../src/run/engine';
import { canQuickApprove } from '../src/run/engineParts';
import { createPrescreener } from '../src/run/prescreen';
import { foldOf } from '../src/run/seed';
import { isRunAsCommand, normalizeText } from './exportDataset';

// Runs the real pipeline over every held-out fold (each scored by its own fold
// model, so no number comes from a model that saw those templates) and over the
// two hand-written sets (scored by the shipped model, which never trained on
// either). With --check it is the CI gate at the chosen floor: a set that breaks
// its recorded start point fails it.

const DATA_DIR = fileURLToPath(new URL('../../ml/data/generated/', import.meta.url));
const SHIPPED_MODEL = fileURLToPath(new URL('../src/model/model.json', import.meta.url));
const FRESH_SET = fileURLToPath(new URL('../../ml/data/handwritten_fresh.jsonl', import.meta.url));
const HISTORY = fileURLToPath(new URL('../src/history/history.json', import.meta.url));
const EVAL_REPORT = fileURLToPath(new URL('../../ml/reports/eval.json', import.meta.url));
const FLOORS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
// The reviewer only acts on flagged tickets, so its seed cannot change a flag or
// a miss; it is fixed so the printed accuracies replay.
const REVIEWER_SEED = 1;
// Approve cards per run: the desk's own full runs (the pace and schedule it uses), on seeds 2000 to 2039.
const APPROVE_FIRST_SEED = 2000;
const APPROVE_RUNS = 40;
// The desk's reviewer closes a ticket this often (web/src/desk/main.ts).
const DESK_REVIEWER_PACE_MS = 2500;
const FRESH_SET_NAME = 'hand-written (fresh)';
const PERCENT = 100;
// The owner froze the fresh set on 2026-10-31; any change to a ticket, label or
// id changes this fingerprint of its parsed rows and fails the run.
const FRESH_SET_SHA256 = '86f91d18c878c5bf911008544dbc7fcb2edaa413ee04d5fa5227b3d6c361975b';

export interface LabeledRow {
  id: string;
  text: string;
  label: TicketLabel;
}

export interface SetResult {
  name: string;
  tickets: number;
  flagRate: number;
  highRiskMissed: number;
  mustReview: number;
}

export interface StartPoint {
  tickets: number;
  missed: number;
  flagRate: number;
  mustReview: number;
}

// A row is refused rather than guessed at: a missing mustReview read as false
// would turn every miss into "not high-risk", and the gate would pass on nothing.
// Truth is looked up by id, so a repeated id would let one row's label replace
// another's.
export function parseRows(jsonl: string): LabeledRow[] {
  const rows = jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      const { id, text, category, priority, mustReview } = row;
      if (
        typeof id !== 'string' ||
        typeof text !== 'string' ||
        !(CATEGORIES as readonly unknown[]).includes(category) ||
        !(PRIORITIES as readonly unknown[]).includes(priority) ||
        typeof mustReview !== 'boolean'
      ) {
        throw new Error('E_BAD_ROW');
      }
      const label: TicketLabel = { category: category as Category, priority: priority as Priority, mustReview };
      return { id, text, label };
    });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error('E_DUPLICATE_ID');
  }
  return rows;
}

export function measureSet(name: string, model: Model, rows: LabeledRow[], floor: number, secondCheckOn: boolean): SetResult {
  const truth = new Map(rows.map((row) => [row.id, row.label]));
  const truthOf = (id: string): TicketLabel => {
    const label = truth.get(id);
    if (label === undefined) throw new Error('E_UNKNOWN_TICKET');
    return label;
  };
  const deps = { model, reviewer: createSimulatedReviewer(REVIEWER_SEED, truthOf), floor, secondCheckOn, now: () => 0 };
  const metrics = computeMetrics(runTickets(rows, deps), truthOf);
  return {
    name,
    tickets: rows.length,
    flagRate: metrics.flagRate,
    highRiskMissed: metrics.highRiskMissed,
    mustReview: rows.filter((row) => row.label.mustReview).length,
  };
}

// The owner's start point, measured at CONFIDENCE_FLOOR with the second check
// off. A set may not miss more high-risk tickets or flag a larger share than it
// did then (flagging everything would miss nothing), and its ticket and
// must-review counts must match (rows or labels lost on the way in would hide
// misses). Lower a number when
// an improvement lands; a rise is the owner's decision.
export const START_POINT: Record<string, StartPoint> = {
  'fold 0': { tickets: 4000, missed: 10, flagRate: 3587 / 4000, mustReview: 1461 },
  'fold 1': { tickets: 4000, missed: 6, flagRate: 3536 / 4000, mustReview: 1461 },
  'fold 2': { tickets: 4000, missed: 10, flagRate: 3509 / 4000, mustReview: 1461 },
  'fold 3': { tickets: 4000, missed: 46, flagRate: 3570 / 4000, mustReview: 1473 },
  'hand-written (seen)': { tickets: 48, missed: 0, flagRate: 32 / 48, mustReview: 22 },
  'hand-written (fresh)': { tickets: 60, missed: 0, flagRate: 47 / 60, mustReview: 24 },
};

// Names of the sets that break their start point; empty means the gate passes.
// A set with no recorded start point fails, and so does a start-point set with
// no result (a set that never loaded would otherwise drop out of the gate).
export function gateFailures(results: SetResult[], start: Record<string, StartPoint> = START_POINT): string[] {
  const measured = new Set(results.map((result) => result.name));
  const broken = results
    .filter((result) => {
      const point = start[result.name];
      return (
        point === undefined ||
        result.tickets !== point.tickets ||
        result.highRiskMissed > point.missed ||
        result.flagRate > point.flagRate ||
        result.mustReview !== point.mustReview
      );
    })
    .map((result) => result.name);
  return [...broken, ...Object.keys(start).filter((name) => !measured.has(name))];
}

export function checkExitCode(results: SetResult[], start: Record<string, StartPoint> = START_POINT): number {
  return gateFailures(results, start).length === 0 ? 0 : 1;
}

// The fresh hand-written set is the untouched test; a ticket that says what a
// training ticket says would make it a memory test instead.
export function assertFreshUnseen(fresh: readonly LabeledRow[], trainingTexts: Iterable<string>): void {
  const seen = new Set(Array.from(trainingTexts, normalizeText));
  if (fresh.some((row) => seen.has(normalizeText(row.text)))) {
    throw new Error('E_FRESH_SEEN');
  }
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function rowsSha256(rows: readonly LabeledRow[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

// The file and fingerprint are parameters so a test can run the real loader on
// small stand-in files; the command uses the defaults.
export function loadSets(
  foldsDir: string,
  read: (path: string) => string = readText,
  freshSha256: string = FRESH_SET_SHA256,
): { name: string; model: Model; rows: LabeledRow[] }[] {
  const sets = [];
  for (let k = 0; k < FOLDS; k += 1) {
    const foldModel = JSON.parse(read(join(foldsDir, `fold_${k}.json`))) as Record<string, unknown>;
    // A fold model that trained on the fold it scores would miss less and pass.
    if (foldModel['heldOutFold'] !== k) throw new Error('E_WRONG_FOLD');
    sets.push({
      name: `fold ${k}`,
      model: loadModel(foldModel),
      rows: parseRows(read(join(DATA_DIR, `heldout_${k}.jsonl`))),
    });
  }
  const shipped = loadModel(JSON.parse(read(SHIPPED_MODEL)));
  // The first hand-written set helped shape the keyword rules, so it is reported
  // as seen; the fresh one was written blind to the rules and the model.
  sets.push({ name: 'hand-written (seen)', model: shipped, rows: parseRows(read(join(DATA_DIR, 'handwritten.jsonl'))) });
  const fresh = parseRows(read(FRESH_SET));
  if (rowsSha256(fresh) !== freshSha256) throw new Error('E_FRESH_CHANGED');
  assertFreshUnseen(fresh, parseRows(read(join(DATA_DIR, 'train_all.jsonl'))).map((row) => row.text));
  sets.push({ name: 'hand-written (fresh)', model: shipped, rows: fresh });
  return sets;
}

export interface EvalNumbers {
  heldOutRight: number;
  handWrittenRight: { k: number; n: number };
  // The old keyword method (v0), which the history's prototype row repeats.
  keywordHeldOutRight: number;
  keywordHandWrittenRight: { k: number; n: number };
}

function dig(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (at, key) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined),
    value,
  );
}

// The numbers of ml/reports/eval.json that the history's current and prototype rows repeat. A report without them is
// refused rather than read as zero, which a row could then match.
export function evalNumbers(report: unknown): EvalNumbers {
  const heldOutRight = dig(report, 'summary', 'model_category', 'mean');
  const k = dig(report, 'handwritten', 'model_category', 'k');
  const n = dig(report, 'handwritten', 'model_category', 'n');
  const keywordHeldOutRight = dig(report, 'summary', 'v0_category', 'mean');
  const keywordK = dig(report, 'handwritten', 'v0_category', 'k');
  const keywordN = dig(report, 'handwritten', 'v0_category', 'n');
  if (
    typeof heldOutRight !== 'number' ||
    typeof k !== 'number' ||
    typeof n !== 'number' ||
    typeof keywordHeldOutRight !== 'number' ||
    typeof keywordK !== 'number' ||
    typeof keywordN !== 'number'
  ) {
    throw new Error('E_EVAL_SHAPE');
  }
  return { heldOutRight, handWrittenRight: { k, n }, keywordHeldOutRight, keywordHandWrittenRight: { k: keywordK, n: keywordN } };
}

// Static codes, one per number of the history's current and prototype rows that differs from the figure it repeats. Held-out
// and hand-written right are the evaluation report's recorded numbers, for both rows. High-risk missed and Sent to a person
// are the fresh set's recorded start point, which the gate holds the measured set to. Only Approve cards per run is measured
// by this command, and it is held to one decimal.
export function historyFailures(
  current: HistoryRow,
  prototype: HistoryRow,
  evaluated: EvalNumbers,
  fresh: StartPoint,
  approve: number,
): string[] {
  const failures: string[] = [];
  if (current.heldOutRight !== evaluated.heldOutRight) failures.push('E_HISTORY_HELD_OUT');
  if (current.handWrittenRight.k !== evaluated.handWrittenRight.k || current.handWrittenRight.n !== evaluated.handWrittenRight.n) {
    failures.push('E_HISTORY_HAND');
  }
  if (prototype.heldOutRight !== evaluated.keywordHeldOutRight) failures.push('E_HISTORY_PROTOTYPE_HELD');
  const keyword = evaluated.keywordHandWrittenRight;
  if (prototype.handWrittenRight.k !== keyword.k || prototype.handWrittenRight.n !== keyword.n) failures.push('E_HISTORY_PROTOTYPE_HAND');
  if (current.highRiskMissed?.k !== fresh.missed || current.highRiskMissed?.n !== fresh.mustReview) failures.push('E_HISTORY_MISSED');
  if (current.sentToPerson !== Math.round(fresh.flagRate * PERCENT) / PERCENT) failures.push('E_HISTORY_SENT');
  if (current.approveCardsPerRun !== Number(approve.toFixed(1))) failures.push('E_HISTORY_APPROVE');
  return failures;
}

// How many cards offer Approve in one full desk run with no viewer: each ticket the pipeline flags counts once, when
// it enters the open list, if its card shows the button.
function approveCardsInRun(seed: number, model: Model): number {
  const run = createRun({
    seed,
    model,
    schedule: createDeskSchedule(seed),
    wallClock: () => 0,
    prescreen: createPrescreener(model),
    closeEveryMs: DESK_REVIEWER_PACE_MS,
    deepTickets: 0,
  });
  const entered = new Set<string>();
  let cards = 0;
  run.play();
  while (run.nextDelayMs() !== null) {
    run.advance();
    for (const trail of run.state().open) {
      if (!entered.has(trail.id)) {
        entered.add(trail.id);
        if (canQuickApprove(trail)) cards += 1;
      }
    }
  }
  return cards;
}

// The average over the runs, each scored by the model of the fold its seed holds out.
export function approveCardsPerRun(modelOf: (fold: number) => Model, firstSeed = APPROVE_FIRST_SEED, runs = APPROVE_RUNS): number {
  let total = 0;
  for (let seed = firstSeed; seed < firstSeed + runs; seed += 1) {
    total += approveCardsInRun(seed, modelOf(foldOf(seed)));
  }
  return total / runs;
}

export interface HistoryCheck {
  approve: number;
  failures: string[];
}

export function checkHistory(foldsDir: string, read: (path: string) => string = readText, runs = APPROVE_RUNS): HistoryCheck {
  const rows: unknown = JSON.parse(read(HISTORY));
  const current = Array.isArray(rows) ? (rows[0] as HistoryRow | undefined) : undefined;
  const prototype = Array.isArray(rows) ? (rows as HistoryRow[]).find((row) => row.id === 'prototype') : undefined;
  const fresh = START_POINT[FRESH_SET_NAME];
  if (current === undefined || prototype === undefined || fresh === undefined) throw new Error('E_HISTORY_SHAPE');
  const folds = new Map<number, Model>();
  const foldModel = (fold: number): Model => {
    const known = folds.get(fold) ?? loadModel(JSON.parse(read(join(foldsDir, `fold_${fold}.json`))));
    folds.set(fold, known);
    return known;
  };
  const approve = approveCardsPerRun(foldModel, APPROVE_FIRST_SEED, runs);
  return { approve, failures: historyFailures(current, prototype, evalNumbers(JSON.parse(read(EVAL_REPORT))), fresh, approve) };
}

function argValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

// The loader, start point and history check are parameters so a test can drive the real --check
// path on a small set; the command uses the defaults.
export function main(args: string[], load = loadSets, start = START_POINT, history = checkHistory): number {
  const foldsDir = argValue(args, '--folds');
  if (foldsDir === undefined) {
    console.log('usage: measurePipeline --folds <dir> [--check]');
    return 2;
  }
  const sets = load(foldsDir);
  console.log('='.repeat(60));
  console.log('PIPELINE MEASUREMENT');
  console.log('='.repeat(60));
  const approved = history(foldsDir);
  console.log(`Approve cards per run: ${approved.approve.toFixed(1)} (mean of ${APPROVE_RUNS} desk runs from seed ${APPROVE_FIRST_SEED})`);
  if (args.includes('--check')) {
    const results = sets.map((set) => measureSet(set.name, set.model, set.rows, CONFIDENCE_FLOOR, SECOND_CHECK_ON));
    for (const r of results) {
      const point = start[r.name];
      const allowed = point === undefined ? 'no start point' : `allowed ${point.missed} missed, ${(point.flagRate * 100).toFixed(1)}% flagged, ${point.mustReview} must-review`;
      console.log(`    ${r.name}: ${r.tickets} tickets, ${r.mustReview} must-review, flagged ${(r.flagRate * 100).toFixed(1)}%, missed ${r.highRiskMissed} (${allowed})`);
    }
    const failed = gateFailures(results, start);
    console.log(failed.length === 0 ? 'PASS: every set at or under its start point' : `FAIL: start point broken in ${failed.join(', ')}`);
    console.log(approved.failures.length === 0 ? 'PASS: the history rows match the recorded evaluation and start point, and the Approve count measured here' : `FAIL: ${approved.failures.join(', ')}`);
    return checkExitCode(results, start) === 0 && approved.failures.length === 0 ? 0 : 1;
  }
  for (const secondCheckOn of [false, true]) {
    console.log(`\nsecond check ${secondCheckOn ? 'on' : 'off'}`);
    for (const floor of FLOORS) {
      const results = sets.map((set) => measureSet(set.name, set.model, set.rows, floor, secondCheckOn));
      const cells = results.map((r) => `${r.name} ${(r.flagRate * 100).toFixed(1)}%/${r.highRiskMissed}`);
      console.log(`    floor ${floor.toFixed(1)}: ${cells.join(' | ')}`);
    }
  }
  return 0;
}

// Run only as a command, never when a test imports the functions above.
if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
