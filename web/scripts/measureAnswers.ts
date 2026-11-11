import { readFileSync } from 'node:fs';
import type { TicketLabel } from '../src/domain/labels';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith } from '../src/pipeline/run';
import { tablePredict, type SavedAnswer } from '../src/pipeline/tableScorer';
import type { ReviewDecision, ReviewInput } from '../src/pipeline/types';
import { ROUTES } from '../src/domain/labels';
import { isRunAsCommand } from './exportDataset';
import { parseRows, type LabeledRow } from './measurePipeline';

// Runs the real rules and review step over tickets whose category and priority
// were answered by a model outside the page, and counts what leaves unchecked.
// A reviewed ticket counts as handled whatever the reviewer answers, so the
// reviewer here simply agrees: only the flag decides each count.

const LOW_SIDE = new Set(['Low', 'Medium']);
const HIGH_SIDE = new Set(['High', 'Urgent']);

export interface AnswersResult {
  tickets: number;
  flagged: number;
  mustReview: number;
  // High-risk tickets no person saw.
  highRiskMissed: number;
  // High or Urgent tickets that left unchecked as Low or Medium.
  highUrgentOutLow: number;
  // Wrong answers no person checked.
  silentCategory: number;
  silentPriority: number;
}

const AGREEING_REVIEWER = {
  decide(input: ReviewInput): ReviewDecision {
    return { ...input.suggestion, route: ROUTES[input.suggestion.category], reason: 'reviewed' };
  },
};

/**
 * Counts what the pipeline lets through unchecked when a saved model answers the tickets.
 *
 * @param rows The tickets with their true labels.
 * @param answers One saved answer per ticket.
 * @param floor The confidence floor.
 * @param secondCheckOn Whether the second check may clear a flag.
 * @returns The counts.
 * @throws Error('E_ANSWER_MISSING') when a ticket has no saved answer, Error('E_ANSWER_SHAPE') for a bad table.
 */
export function measureAnswers(
  rows: readonly LabeledRow[],
  answers: readonly SavedAnswer[],
  floor: number = CONFIDENCE_FLOOR,
  secondCheckOn: boolean = SECOND_CHECK_ON,
): AnswersResult {
  const predict = tablePredict(answers);
  const settings = { reviewer: AGREEING_REVIEWER, floor, secondCheckOn, now: () => 0 };
  const result: AnswersResult = { tickets: rows.length, flagged: 0, mustReview: 0, highRiskMissed: 0, highUrgentOutLow: 0, silentCategory: 0, silentPriority: 0 };
  for (const row of rows) {
    const truth: TicketLabel = row.label;
    const trail = runTicketWith(row.text, row.id, predict, settings);
    result.mustReview += truth.mustReview ? 1 : 0;
    if (trail.guard.flagged) {
      result.flagged += 1;
      continue;
    }
    result.highRiskMissed += truth.mustReview ? 1 : 0;
    result.highUrgentOutLow += HIGH_SIDE.has(truth.priority) && LOW_SIDE.has(trail.final.priority) ? 1 : 0;
    result.silentCategory += trail.final.category !== truth.category ? 1 : 0;
    result.silentPriority += trail.final.priority !== truth.priority ? 1 : 0;
  }
  return result;
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function main(args: readonly string[]): number {
  const rowsPath = argValue(args, '--rows');
  const answersPath = argValue(args, '--answers');
  if (rowsPath === undefined || answersPath === undefined) {
    console.log('usage: measureAnswers --rows <tickets.jsonl> --answers <answers.json> [--floor <0..1>]');
    return 2;
  }
  const floor = Number(argValue(args, '--floor') ?? CONFIDENCE_FLOOR);
  const rows = parseRows(readFileSync(rowsPath, 'utf8'));
  const answers = JSON.parse(readFileSync(answersPath, 'utf8')) as SavedAnswer[];
  console.log(JSON.stringify(measureAnswers(rows, answers, floor)));
  return 0;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
