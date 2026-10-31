import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, type Category, type Priority, type TicketLabel } from '../src/domain/labels';
import { FOLDS } from '../src/generator/templates';
import { loadModel, type Model } from '../src/model/scorer';
import { computeMetrics } from '../src/pipeline/metrics';
import { createSimulatedReviewer } from '../src/pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTickets } from '../src/pipeline/run';
import { isRunAsCommand } from './exportDataset';

// Runs the real pipeline over every held-out fold (each scored by its own fold
// model, so no number comes from a model that saw those templates) and over the
// hand-written set (scored by the shipped model, which never trained on it).
// With --check it is the CI gate at the chosen floor: a set that misses more
// high-risk tickets than its recorded start point fails it.

const DATA_DIR = fileURLToPath(new URL('../../ml/data/generated/', import.meta.url));
const SHIPPED_MODEL = fileURLToPath(new URL('../src/model/model.json', import.meta.url));
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
  return { name, tickets: rows.length, flagRate: metrics.flagRate, highRiskMissed: metrics.highRiskMissed };
}

// The owner's start point (2026-10-31), measured at CONFIDENCE_FLOOR with the
// second check off: a fold may not miss more than it did then, and the
// hand-written set may miss none. Lower a number when an improvement lands.
export const START_POINT_MISSES: Record<string, number> = {
  'fold 0': 9,
  'fold 1': 6,
  'fold 2': 10,
  'fold 3': 46,
  'hand-written': 0,
};

// Names of the sets over their start point; empty means the gate passes. A set
// with no recorded start point may miss nothing.
export function gateFailures(results: SetResult[]): string[] {
  return results
    .filter((result) => result.highRiskMissed > (START_POINT_MISSES[result.name] ?? 0))
    .map((result) => result.name);
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
  sets.push({
    name: 'hand-written',
    model: loadModel(JSON.parse(read(SHIPPED_MODEL))),
    rows: parseRows(read(join(DATA_DIR, 'handwritten.jsonl'))),
  });
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
      const allowed = START_POINT_MISSES[r.name] ?? 0;
      console.log(`    ${r.name}: ${r.tickets} tickets, flagged ${(r.flagRate * 100).toFixed(1)}%, missed ${r.highRiskMissed} (allowed ${allowed})`);
    }
    const failed = gateFailures(results);
    console.log(failed.length === 0 ? 'PASS: every set at or under its start point' : `FAIL: more high-risk tickets missed than the start point in ${failed.join(', ')}`);
    return failed.length === 0 ? 0 : 1;
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
