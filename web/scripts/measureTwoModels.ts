import { readFileSync } from 'node:fs';
import { ROUTES } from '../src/domain/labels';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith } from '../src/pipeline/run';
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
// model's answer and no count below can be higher than the gate model's alone.

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
  const gatePredict = tablePredict(gateAnswers);
  const answerPredict = tablePredict(answerAnswers);
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

function main(args: readonly string[]): number {
  const rowsPath = argValue(args, '--rows');
  const gatePath = argValue(args, '--gate');
  const answerPath = argValue(args, '--answer');
  if (rowsPath === undefined || gatePath === undefined || answerPath === undefined) {
    console.log('usage: measureTwoModels --rows <tickets.jsonl> --gate <answers.json> --answer <answers.json> [--floor <0..1>]');
    return 2;
  }
  const floor = Number(argValue(args, '--floor') ?? CONFIDENCE_FLOOR);
  const rows = parseRows(readFileSync(rowsPath, 'utf8'));
  const read = (path: string): SavedAnswer[] => JSON.parse(readFileSync(path, 'utf8')) as SavedAnswer[];
  console.log(JSON.stringify(measureTwoModels(rows, read(gatePath), read(answerPath), floor)));
  return 0;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
