import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, type Category, type Priority, type TicketLabel } from '../src/domain/labels';
import { FOLDS } from '../src/generator/templates';
import { loadModel, type Model } from '../src/model/scorer';
import { computeMetrics } from '../src/pipeline/metrics';
import { createSimulatedReviewer } from '../src/pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTickets } from '../src/pipeline/run';
import { isRunAsCommand, normalizeText } from './exportDataset';

// Runs the real pipeline over every held-out fold (each scored by its own fold
// model, so no number comes from a model that saw those templates) and over the
// two hand-written sets (scored by the shipped model, which never trained on
// either). With --check it is the CI gate at the chosen floor: a set that breaks
// its recorded start point fails it.

const DATA_DIR = fileURLToPath(new URL('../../ml/data/generated/', import.meta.url));
const SHIPPED_MODEL = fileURLToPath(new URL('../src/model/model.json', import.meta.url));
const FRESH_SET = fileURLToPath(new URL('../../ml/data/handwritten_fresh.jsonl', import.meta.url));
const FLOORS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
// The reviewer only acts on flagged tickets, so its seed cannot change a flag or
// a miss; it is fixed so the printed accuracies replay.
const REVIEWER_SEED = 1;

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
  missed: number;
  flagRate: number;
  mustReview: number;
}

// A row is refused rather than guessed at: a missing mustReview read as false
// would turn every miss into "not high-risk", and the gate would pass on nothing.
export function parseRows(jsonl: string): LabeledRow[] {
  return jsonl
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
// did then (flagging everything would miss nothing), and its must-review count
// must match (labels lost on the way in would hide misses). Lower a number when
// an improvement lands; a rise is the owner's decision.
export const START_POINT: Record<string, StartPoint> = {
  'fold 0': { missed: 10, flagRate: 3587 / 4000, mustReview: 1461 },
  'fold 1': { missed: 6, flagRate: 3536 / 4000, mustReview: 1461 },
  'fold 2': { missed: 10, flagRate: 3509 / 4000, mustReview: 1461 },
  'fold 3': { missed: 46, flagRate: 3570 / 4000, mustReview: 1473 },
  'hand-written (seen)': { missed: 0, flagRate: 32 / 48, mustReview: 22 },
  'hand-written (fresh)': { missed: 0, flagRate: 47 / 60, mustReview: 24 },
};

// Names of the sets that break their start point; empty means the gate passes.
// A set with no recorded start point always fails.
export function gateFailures(results: SetResult[], start: Record<string, StartPoint> = START_POINT): string[] {
  return results
    .filter((result) => {
      const point = start[result.name];
      return (
        point === undefined ||
        result.highRiskMissed > point.missed ||
        result.flagRate > point.flagRate ||
        result.mustReview !== point.mustReview
      );
    })
    .map((result) => result.name);
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

function loadSets(foldsDir: string): { name: string; model: Model; rows: LabeledRow[] }[] {
  const read = (path: string): string => readFileSync(path, 'utf8');
  const sets = [];
  for (let k = 0; k < FOLDS; k += 1) {
    sets.push({
      name: `fold ${k}`,
      model: loadModel(JSON.parse(read(join(foldsDir, `fold_${k}.json`)))),
      rows: parseRows(read(join(DATA_DIR, `heldout_${k}.jsonl`))),
    });
  }
  const shipped = loadModel(JSON.parse(read(SHIPPED_MODEL)));
  // The first hand-written set helped shape the keyword rules, so it is reported
  // as seen; the fresh one was written blind to the rules and the model.
  sets.push({ name: 'hand-written (seen)', model: shipped, rows: parseRows(read(join(DATA_DIR, 'handwritten.jsonl'))) });
  const fresh = parseRows(read(FRESH_SET));
  assertFreshUnseen(fresh, parseRows(read(join(DATA_DIR, 'train_all.jsonl'))).map((row) => row.text));
  sets.push({ name: 'hand-written (fresh)', model: shipped, rows: fresh });
  return sets;
}

function argValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

function main(args: string[]): number {
  const foldsDir = argValue(args, '--folds');
  if (foldsDir === undefined) {
    console.log('usage: measurePipeline --folds <dir> [--check]');
    return 2;
  }
  const sets = loadSets(foldsDir);
  console.log('='.repeat(60));
  console.log('PIPELINE MEASUREMENT');
  console.log('='.repeat(60));
  if (args.includes('--check')) {
    const results = sets.map((set) => measureSet(set.name, set.model, set.rows, CONFIDENCE_FLOOR, SECOND_CHECK_ON));
    for (const r of results) {
      const point = START_POINT[r.name];
      const allowed = point === undefined ? 'no start point' : `allowed ${point.missed} missed, ${(point.flagRate * 100).toFixed(1)}% flagged, ${point.mustReview} must-review`;
      console.log(`    ${r.name}: ${r.tickets} tickets, ${r.mustReview} must-review, flagged ${(r.flagRate * 100).toFixed(1)}%, missed ${r.highRiskMissed} (${allowed})`);
    }
    const failed = gateFailures(results);
    console.log(failed.length === 0 ? 'PASS: every set at or under its start point' : `FAIL: start point broken in ${failed.join(', ')}`);
    return checkExitCode(results);
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
