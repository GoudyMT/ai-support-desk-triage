import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, type Category, type Priority, type TicketLabel } from '../src/domain/labels';
import { FOLDS } from '../src/generator/templates';
import { loadModel, type Model } from '../src/model/scorer';
import { computeMetrics } from '../src/pipeline/metrics';
import { createSimulatedReviewer } from '../src/pipeline/reviewer';
import { runTickets } from '../src/pipeline/run';
import { isRunAsCommand } from './exportDataset';

// Runs the real pipeline over every held-out fold (each scored by its own fold
// model, so no number comes from a model that saw those templates) and over the
// hand-written set (scored by the shipped model, which never trained on it).
// With --check <floor> it is the CI gate: any high-risk ticket missed fails it.

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

// Names of the sets that missed a high-risk ticket; empty means the gate passes.
export function gateFailures(results: SetResult[]): string[] {
  return results.filter((result) => result.highRiskMissed > 0).map((result) => result.name);
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
    console.log('usage: measurePipeline --folds <dir> [--check <floor> [--second-check]]');
    return 2;
  }
  const sets = loadSets(foldsDir);
  const check = argValue(args, '--check');
  console.log('='.repeat(60));
  console.log('PIPELINE MEASUREMENT');
  console.log('='.repeat(60));
  if (check !== undefined) {
    const floor = Number(check);
    const secondCheckOn = args.includes('--second-check');
    const results = sets.map((set) => measureSet(set.name, set.model, set.rows, floor, secondCheckOn));
    for (const r of results) {
      console.log(`    ${r.name}: ${r.tickets} tickets, flagged ${(r.flagRate * 100).toFixed(1)}%, missed ${r.highRiskMissed}`);
    }
    const failed = gateFailures(results);
    console.log(failed.length === 0 ? 'PASS: no high-risk ticket missed' : `FAIL: high-risk tickets missed in ${failed.join(', ')}`);
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
