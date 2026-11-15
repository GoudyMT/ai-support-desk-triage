import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Category, Priority, ReviewReason } from '../src/domain/labels';
import { loadModel, score } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, type Predict } from '../src/pipeline/run';
import type { Reviewer, TicketTrail } from '../src/pipeline/types';
import { routeTicketWith } from '../src/run/splitFlow';
import { runTicketWith } from '../src/pipeline/run';
import { isRunAsCommand } from './exportDataset';
import { parseRows, type LabeledRow } from './measurePipeline';

// Measures the three-path desk (`src/run/splitFlow.ts`) beside the v1.1 desk (the two-model rule) on the same
// tickets and the same recorded sentence answers: the desk-only wording, both hand-written sets, and the four
// generated folds with their own word models. "Risky" is a ticket a person must handle for one of the five risk
// reasons; a vague ticket is a routing doubt and is counted on its own line. Writes or checks
// `ml/reports/split_flow.json`; the check also fails when the three-path desk is worse than the v1.1 desk on any
// safety line. Run from the project root: npm --prefix web run measure-split -- --check

const REVIEW_REASONS: readonly ReviewReason[] = ['security incident', 'accessibility issue', 'billing dispute', 'threatening language', 'escalated complaint', 'vague ticket'];
const HIGH: readonly Priority[] = ['High', 'Urgent'];

export interface RiskRow extends LabeledRow {
  reviewReason: ReviewReason | null;
}

export interface TodayCounts {
  cards: number;
  riskyMissed: number;
  // A truly High or Urgent ticket that reached a team below High with no operator check.
  highOutLow: number;
  uncheckedWrongDept: number;
  uncheckedWrongPriority: number;
  vagueDirect: number;
}

export interface SplitLines extends TodayCounts {
  marked: number;
  markedRisky: number;
  falseMarks: number;
  markedWrongTeam: number;
  markedWrongTeamRisky: number;
  markedWrongPriority: number;
}

export interface SplitCounts {
  tickets: number;
  today: TodayCounts;
  split: SplitLines;
}

export type Answer = { category: Category; priority: Priority };

// The safety lines the three-path desk may never be worse on than the v1.1 desk.
const HELD_LINES = ['riskyMissed', 'highOutLow', 'uncheckedWrongDept', 'uncheckedWrongPriority'] as const;

// The operator's answer is not counted anywhere here, so the stand-in reviewer takes the suggestion.
const TAKES_SUGGESTION: Reviewer = { decide: (input) => ({ ...input.suggestion, route: '' }) };

const isRisky = (row: RiskRow): boolean => row.label.mustReview && row.reviewReason !== 'vague ticket';

/**
 * Reads ticket rows with their review reason.
 *
 * Args:
 *   jsonl: one ticket per line, as the exporters write them.
 *
 * Returns:
 *   The rows.
 *
 * Raises:
 *   Error('E_BAD_ROW') for a review reason the labels do not know, plus whatever parseRows refuses.
 */
export function parseRiskRows(jsonl: string): RiskRow[] {
  const reasons = new Map<string, ReviewReason | null>();
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue;
    const raw = JSON.parse(line) as { id?: unknown; reviewReason?: unknown };
    const reason = raw.reviewReason ?? null;
    if (reason !== null && !(REVIEW_REASONS as readonly unknown[]).includes(reason)) {
      throw new Error('E_BAD_ROW');
    }
    reasons.set(String(raw.id), reason as ReviewReason | null);
  }
  return parseRows(jsonl).map((row) => ({ ...row, reviewReason: reasons.get(row.id) ?? null }));
}

function countToday(c: TodayCounts, row: RiskRow, trail: TicketTrail): void {
  const vague = row.reviewReason === 'vague ticket';
  if (trail.guard.flagged) {
    c.cards += 1;
    return;
  }
  if (isRisky(row)) c.riskyMissed += 1;
  if (vague) c.vagueDirect += 1;
  if (HIGH.includes(row.label.priority) && !HIGH.includes(trail.final.priority)) c.highOutLow += 1;
  if (trail.final.category !== row.label.category) c.uncheckedWrongDept += 1;
  if (trail.final.priority !== row.label.priority) c.uncheckedWrongPriority += 1;
}

// Adds one ticket's three-path trail to the counts. Exported so a marked trail below High can be counted in a test:
// the flow itself never leaves one there.
export function countSplit(c: SplitLines, row: RiskRow, trail: TicketTrail): void {
  if (trail.path === 'triage') {
    c.cards += 1;
    return;
  }
  const wrongTeam = trail.final.category !== row.label.category;
  const wrongPriority = trail.final.priority !== row.label.priority;
  if (HIGH.includes(row.label.priority) && !HIGH.includes(trail.final.priority)) c.highOutLow += 1;
  if (trail.path === 'marked') {
    c.marked += 1;
    if (isRisky(row)) c.markedRisky += 1;
    else c.falseMarks += 1;
    if (wrongTeam) c.markedWrongTeam += 1;
    if (wrongTeam && isRisky(row)) c.markedWrongTeamRisky += 1;
    if (wrongPriority) c.markedWrongPriority += 1;
    return;
  }
  if (isRisky(row)) c.riskyMissed += 1;
  if (row.reviewReason === 'vague ticket') c.vagueDirect += 1;
  if (wrongTeam) c.uncheckedWrongDept += 1;
  if (wrongPriority) c.uncheckedWrongPriority += 1;
}

/**
 * Counts one set on the v1.1 desk and the three-path desk.
 *
 * Args:
 *   rows: the tickets with their true labels and review reasons.
 *   word: the word model's scorer.
 *   sentence: the sentence model's recorded answer for a ticket id.
 *
 * Returns:
 *   The counts for both desks.
 */
export function measureSplit(rows: readonly RiskRow[], word: Predict, sentence: (id: string) => Answer): SplitCounts {
  const settings = { reviewer: TAKES_SUGGESTION, floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  const today: TodayCounts = { cards: 0, riskyMissed: 0, highOutLow: 0, uncheckedWrongDept: 0, uncheckedWrongPriority: 0, vagueDirect: 0 };
  const split: SplitLines = { ...today, marked: 0, markedRisky: 0, falseMarks: 0, markedWrongTeam: 0, markedWrongTeamRisky: 0, markedWrongPriority: 0 };
  const certain = (label: string) => ({ label, confidence: 1, probabilities: {}, topTerms: [] });
  for (const row of rows) {
    const said = sentence(row.id);
    countSplit(split, row, routeTicketWith(row.text, row.id, word, { ...settings, suggest: () => said }));
    // The v1.1 desk: a ticket leaves unchecked only when the word model lets it and the sentence answer, after the
    // same rules, is the same department and priority.
    const gate = runTicketWith(row.text, row.id, word, settings);
    const answer = runTicketWith(row.text, row.id, (head) => certain(head === 'category' ? said.category : said.priority), { ...settings, floor: 0 });
    const same = answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
    countToday(today, row, { ...gate, guard: { ...gate.guard, flagged: gate.guard.flagged || answer.guard.flagged || !same } });
  }
  return { tickets: rows.length, today, split };
}

/**
 * Names each safety line on which the three-path desk is worse than the v1.1 desk.
 *
 * Args:
 *   counts: one set's counts.
 *
 * Returns:
 *   The worse lines; empty when none is.
 */
export function lineBreaches(counts: SplitCounts): string[] {
  return HELD_LINES.filter((line) => counts.split[line] > counts.today[line]);
}

const ANSWERS_RECORD = new URL('../../ml/reports/bundle_v2_answers.json', import.meta.url);
const FOLD_ANSWERS = new URL('../../ml/reports/sentence_fold_answers.json', import.meta.url);
const REPORT = new URL('../../ml/reports/split_flow.json', import.meta.url);
const GENERATED_DIR = new URL('../../ml/data/generated/', import.meta.url);
const SHIPPED_MODEL = new URL('../src/model/model.json', import.meta.url);
const FOLD_MODELS = new URL('../public/models/', import.meta.url);
const HOW = 'npm --prefix web run measure-split -- --write (worked out again by CI with --check)';

type AnswerList = readonly (readonly [string, string, string])[];

function lookup(answers: AnswerList, rows: readonly RiskRow[]): (id: string) => Answer {
  if (answers.length !== rows.length || answers.some(([id], index) => id !== rows[index]?.id)) {
    throw new Error('E_ANSWER_SET');
  }
  const byId = new Map(answers.map(([id, category, priority]) => [id, { category: category as Category, priority: priority as Priority }]));
  return (id) => {
    const found = byId.get(id);
    if (found === undefined) throw new Error('E_ANSWER_SET');
    return found;
  };
}

function wordOf(url: URL): Predict {
  const model = loadModel(JSON.parse(readFileSync(url, 'utf8')));
  return (head, maskedText) => score(model, head, maskedText);
}

function buildReport(): { how: string; sets: Record<string, SplitCounts> } {
  const read = (file: string) => parseRiskRows(readFileSync(new URL(file, GENERATED_DIR), 'utf8'));
  const sets: Record<string, SplitCounts> = {};
  const record = JSON.parse(readFileSync(ANSWERS_RECORD, 'utf8')) as { sets: Record<string, { file: string; answers: AnswerList }> };
  const shipped = wordOf(SHIPPED_MODEL);
  for (const [name, { file, answers }] of Object.entries(record.sets)) {
    const rows = read(file);
    sets[name] = measureSplit(rows, shipped, lookup(answers, rows));
  }
  const folds = JSON.parse(readFileSync(FOLD_ANSWERS, 'utf8')) as Record<string, { answers: AnswerList }>;
  for (const [fold, { answers }] of Object.entries(folds)) {
    const rows = read(`heldout_${fold}.jsonl`);
    sets[`fold ${fold}`] = measureSplit(rows, wordOf(new URL(`fold_${fold}.json`, FOLD_MODELS)), lookup(answers, rows));
  }
  return { how: HOW, sets };
}

function main(args: readonly string[]): number {
  const built = buildReport();
  if (args.includes('--write')) {
    writeFileSync(REPORT, `${JSON.stringify(built, null, 1)}\n`, 'utf8');
    console.log(`wrote ${fileURLToPath(REPORT)} (${Object.keys(built.sets).length} sets)`);
  } else if (!args.includes('--check')) {
    console.log('usage: measureSplit --write | --check');
    return 2;
  }
  const recorded = JSON.parse(readFileSync(REPORT, 'utf8')) as typeof built;
  const names = new Set([...Object.keys(recorded.sets), ...Object.keys(built.sets)]);
  const differing = [...names].filter((name) => JSON.stringify(recorded.sets[name]) !== JSON.stringify(built.sets[name]));
  const worse = Object.entries(built.sets).flatMap(([name, counts]) => lineBreaches(counts).map((line) => `${name} ${line}`));
  for (const name of differing) console.log(`FAIL record differs: ${name}`);
  for (const line of worse) console.log(`FAIL worse than the v1.1 desk: ${line}`);
  if (differing.length === 0 && worse.length === 0) console.log('PASS three-path record matches and no safety line is worse');
  return differing.length === 0 && worse.length === 0 ? 0 : 1;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
