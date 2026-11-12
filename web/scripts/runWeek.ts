import { readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, type Category, type Priority, type TicketLabel } from '../src/domain/labels';
import { loadModel, score } from '../src/model/scorer';
import { REVIEWER_ERROR_RATE, createSimulatedReviewer } from '../src/pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith, type Predict } from '../src/pipeline/run';
import { tablePredict, type SavedAnswer } from '../src/pipeline/tableScorer';
import type { ReviewDecision, ReviewInput, TicketTrail } from '../src/pipeline/types';
import { isRunAsCommand } from './exportDataset';
import { parseRows, type LabeledRow } from './measurePipeline';

// One simulated week of the 90-day run. The word model is the gate, as on the
// desk; each answer model (the one that retrains, and the frozen start model
// beside it) gives the suggestion, and a ticket leaves unchecked only when the
// gate lets it and both agree (the two-model rule). Tickets the retrained path
// sends to a person get the simulated reviewer's answer, mistakes included, and
// become the next training rows. Every count is against the true label.

const DAYS_PER_WEEK = 7;
const LOW_SIDE = new Set(['Low', 'Medium']);
const HIGH_SIDE = new Set(['High', 'Urgent']);
// The answer model is only compared with the gate, never used as a gate.
const NO_FLOOR = 0;
// A seed of its own, so the reviewer's slips in the run are not those of any other measurement.
const REVIEWER_SEED = 61;

export interface WeekLabeledRow extends LabeledRow {
  day: number;
}

export interface ModelDay {
  tickets: number;
  toPerson: number;
  categoryRight: number;
  priorityRight: number;
  highUrgentOutLow: number;
  highRiskMissed: number;
  silentCategory: number;
  silentPriority: number;
}

export interface CheckedRow {
  id: string;
  maskedText: string;
  category: Category;
  priority: Priority;
  day: number;
}

export interface WeekResult {
  days: { day: number; retrained: ModelDay; frozen: ModelDay }[];
  checked: CheckedRow[];
}

const AGREEING_REVIEWER = {
  decide(input: ReviewInput): ReviewDecision {
    return { ...input.suggestion, route: ROUTES[input.suggestion.category], reason: 'reviewed' };
  },
};

function emptyDay(): ModelDay {
  return { tickets: 0, toPerson: 0, categoryRight: 0, priorityRight: 0, highUrgentOutLow: 0, highRiskMissed: 0, silentCategory: 0, silentPriority: 0 };
}

// Counts one ticket for one answer model; true when the ticket goes to a person.
function countTicket(day: ModelDay, label: TicketLabel, gate: TicketTrail, answer: TicketTrail): boolean {
  day.tickets += 1;
  day.categoryRight += answer.category.label === label.category ? 1 : 0;
  day.priorityRight += answer.guard.priority === label.priority ? 1 : 0;
  const agree = !answer.guard.flagged && answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
  if (!gate.guard.flagged && agree) {
    day.highRiskMissed += label.mustReview ? 1 : 0;
    day.highUrgentOutLow += HIGH_SIDE.has(label.priority) && LOW_SIDE.has(gate.final.priority) ? 1 : 0;
    day.silentCategory += gate.final.category !== label.category ? 1 : 0;
    day.silentPriority += gate.final.priority !== label.priority ? 1 : 0;
    return false;
  }
  day.toPerson += 1;
  return true;
}

/**
 * Runs one week's tickets through the gate and the two-model rule, for the retrained and the frozen model.
 *
 * @param rows The week's tickets, each with its day (1 to 7) and true label.
 * @param gate The word model that decides what may leave unchecked.
 * @param retrained The answer model being retrained week by week.
 * @param frozen The start model, never retrained, scored on the same tickets.
 * @param errorRate How often the simulated reviewer picks a wrong department.
 * @returns Counts per day for both models, and the tickets a person checked on the retrained path with the reviewer's answer.
 * @throws Error('E_WEEK_DAY') for a day outside 1 to 7; Error('E_WEEK_ID') for a repeated id.
 */
export function runWeek(
  rows: readonly WeekLabeledRow[],
  gate: Predict,
  retrained: Predict,
  frozen: Predict,
  errorRate: number = REVIEWER_ERROR_RATE,
): WeekResult {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!Number.isInteger(row.day) || row.day < 1 || row.day > DAYS_PER_WEEK) {
      throw new Error('E_WEEK_DAY');
    }
    if (ids.has(row.id)) {
      throw new Error('E_WEEK_ID');
    }
    ids.add(row.id);
  }
  const truth = new Map(rows.map((row) => [row.id, row.label]));
  const reviewer = createSimulatedReviewer(REVIEWER_SEED, (id) => truth.get(id) as TicketLabel, errorRate);
  const base = { reviewer: AGREEING_REVIEWER, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => ({ day: i + 1, retrained: emptyDay(), frozen: emptyDay() }));
  const checked: CheckedRow[] = [];
  for (const row of rows) {
    const day = days[row.day - 1] as (typeof days)[number];
    const gateTrail = runTicketWith(row.text, row.id, gate, { ...base, floor: CONFIDENCE_FLOOR });
    const retrainedTrail = runTicketWith(row.text, row.id, retrained, { ...base, floor: NO_FLOOR });
    const frozenTrail = runTicketWith(row.text, row.id, frozen, { ...base, floor: NO_FLOOR });
    countTicket(day.frozen, row.label, gateTrail, frozenTrail);
    if (countTicket(day.retrained, row.label, gateTrail, retrainedTrail)) {
      const suggestion = { category: retrainedTrail.category.label as Category, priority: retrainedTrail.guard.priority };
      const decision = reviewer.decide({ id: row.id, maskedText: retrainedTrail.maskedText, suggestion, reasons: retrainedTrail.guard.reasons });
      checked.push({ id: row.id, maskedText: retrainedTrail.maskedText, category: decision.category, priority: decision.priority, day: row.day });
    }
  }
  return { days, checked };
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function main(args: readonly string[]): number {
  const [rowsPath, week, gatePath, retrainedPath, frozenPath, out] = ['--rows', '--week', '--gate-model', '--retrained', '--frozen', '--out'].map((name) => argValue(args, name));
  if (rowsPath === undefined || week === undefined || gatePath === undefined || retrainedPath === undefined || frozenPath === undefined || out === undefined) {
    console.log('usage: runWeek --rows <v2_weeks_k.jsonl> --week <0..12> --gate-model <fold_k.json> --retrained <answers.json> --frozen <answers.json> --out <result.json>');
    return 2;
  }
  const weekNumber = Number(week);
  const lines = readFileSync(rowsPath, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const meta = new Map(lines.map((line) => JSON.parse(line) as { id: string; week: number; day: number }).map((m) => [m.id, m]));
  const rows = parseRows(lines.join('\n'))
    .filter((row) => meta.get(row.id)?.week === weekNumber)
    .map((row) => ({ ...row, day: meta.get(row.id)?.day ?? 0 }));
  const gateModel = loadModel(JSON.parse(readFileSync(gatePath, 'utf8')));
  const gate: Predict = (head, maskedText) => score(gateModel, head, maskedText);
  const read = (path: string): SavedAnswer[] => JSON.parse(readFileSync(path, 'utf8')) as SavedAnswer[];
  const result = runWeek(rows, gate, tablePredict(read(retrainedPath)), tablePredict(read(frozenPath)));
  writeFileSync(out, `${JSON.stringify({ week: weekNumber, ...result })}\n`, 'utf8');
  console.log(`wrote ${out} (${rows.length} tickets, ${result.checked.length} checked)`);
  return 0;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
