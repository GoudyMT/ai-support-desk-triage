import { readFileSync } from 'node:fs';
import { CATEGORIES, PRIORITIES } from '../src/domain/labels';
import { loadModel, score, type Model } from '../src/model/scorer';
import { SECOND_CHECK_ON, runTicketWith, type Predict } from '../src/pipeline/run';
import { tablePredict } from '../src/pipeline/tableScorer';
import type { AnswersResult } from './measureAnswers';
import { isRunAsCommand } from './exportDataset';
import { parseRows, type LabeledRow } from './measurePipeline';
import { measureTwoPredictors } from './measureTwoModels';

// Measures one change to the two-model rule: when both models give the same department and priority, the word model
// being under its confidence floor no longer sends the ticket to a person. The rules and the always-checked
// departments still do. The bar, written before any number of this change existed (the owner, 2026-11-14): fewer
// tickets to a person on every set; high-risk missed and High/Urgent out as Low/Medium never above the desk's rule
// today; wrong department and wrong priority out unchecked at most the locked allowance above it (0.25% of the set, at
// least 1 ticket).

const ALLOWANCE_SHARE = 0.0025;
const NO_FLOOR = 0;
const LOW_SIDE = new Set(['Low', 'Medium']);
const HIGH_SIDE = new Set(['High', 'Urgent']);
const AGREEING_REVIEWER = { decide: (input: { suggestion: { category: string; priority: string } }) => ({ ...input.suggestion, route: '', reason: 'reviewed' }) };

export interface AgreementResult {
  today: AnswersResult;
  lifted: AnswersResult;
}

function emptyResult(tickets: number): AnswersResult {
  return { tickets, flagged: 0, mustReview: 0, highRiskMissed: 0, highUrgentOutLow: 0, silentCategory: 0, silentPriority: 0 };
}

/**
 * Counts what leaves unchecked under the desk's two-model rule today and with the floor lifted on agreement.
 *
 * Args:
 *   rows: the tickets with their true labels.
 *   gatePredict: the word model's scorer.
 *   answerPredict: the sentence model's scorer.
 *
 * Returns:
 *   Both sets of counts.
 */
export function measureAgreement(rows: readonly LabeledRow[], gatePredict: Predict, answerPredict: Predict): AgreementResult {
  const today = measureTwoPredictors(rows, gatePredict, answerPredict).both;
  const lifted = emptyResult(rows.length);
  const base = { reviewer: AGREEING_REVIEWER as never, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  for (const row of rows) {
    const unfloored = runTicketWith(row.text, row.id, gatePredict, { ...base, floor: NO_FLOOR });
    const answer = runTicketWith(row.text, row.id, answerPredict, { ...base, floor: NO_FLOOR });
    lifted.mustReview += row.label.mustReview ? 1 : 0;
    // Only the floor is lifted. The sentence answer is run with no floor, so it is flagged only by a rule or an
    // always-checked department; when it is not flagged and both answers match, neither is the word model's.
    const agree = !answer.guard.flagged && answer.final.category === unfloored.final.category && answer.final.priority === unfloored.final.priority;
    if (agree) {
      lifted.highRiskMissed += row.label.mustReview ? 1 : 0;
      lifted.highUrgentOutLow += HIGH_SIDE.has(row.label.priority) && LOW_SIDE.has(unfloored.final.priority) ? 1 : 0;
      lifted.silentCategory += unfloored.final.category !== row.label.category ? 1 : 0;
      lifted.silentPriority += unfloored.final.priority !== row.label.priority ? 1 : 0;
    } else {
      lifted.flagged += 1;
    }
  }
  return { today, lifted };
}

/** The bar's verdict on one set: each part, and whether all hold. */
export function judge({ today, lifted }: AgreementResult): { fewer: boolean; hardLines: boolean; accuracy: boolean; met: boolean } {
  const allowance = Math.max(1, Math.ceil(today.tickets * ALLOWANCE_SHARE));
  const fewer = lifted.flagged < today.flagged;
  const hardLines = lifted.highRiskMissed <= today.highRiskMissed && lifted.highUrgentOutLow <= today.highUrgentOutLow;
  const accuracy = lifted.silentCategory <= today.silentCategory + allowance && lifted.silentPriority <= today.silentPriority + allowance;
  return { fewer, hardLines, accuracy, met: fewer && hardLines && accuracy };
}

function chosenTable(answers: readonly (readonly [string, string, string])[]): Predict {
  const whole = (classes: readonly string[], choice: string) => Object.fromEntries(classes.map((name) => [name, name === choice ? 1 : 0]));
  return tablePredict(answers.map(([id, category, priority]) => ({ id, category_probs: whole(CATEGORIES, category), priority_probs: whole(PRIORITIES, priority) })));
}

const modelPredict = (model: Model): Predict => (head, maskedText) => score(model, head, maskedText);
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

function report(name: string, result: AgreementResult): boolean {
  const verdict = judge(result);
  const { today, lifted } = result;
  const share = (n: number) => `${((n / today.tickets) * 100).toFixed(1)}%`;
  console.log(`${name}: to a person ${share(today.flagged)} -> ${share(lifted.flagged)} | high-risk out ${today.highRiskMissed} -> ${lifted.highRiskMissed} | High/Urgent out low ${today.highUrgentOutLow} -> ${lifted.highUrgentOutLow} | wrong dept out ${today.silentCategory} -> ${lifted.silentCategory} | wrong priority out ${today.silentPriority} -> ${lifted.silentPriority} | ${verdict.met ? 'MET' : `NOT MET ${JSON.stringify(verdict)}`}`);
  return verdict.met;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  // Choosing ground: each held-out fold, scored by the word and sentence models that never saw its wording.
  const folds = JSON.parse(read('../../ml/reports/sentence_fold_answers.json')) as Record<string, { answers: [string, string, string][] }>;
  let met = true;
  for (const [fold, { answers }] of Object.entries(folds)) {
    const rows = parseRows(read(`../../ml/data/generated/heldout_${fold}.jsonl`));
    const word = loadModel(JSON.parse(read(`../public/models/fold_${fold}.json`)));
    met = report(`fold ${fold}`, measureAgreement(rows, modelPredict(word), chosenTable(answers))) && met;
  }
  // Confirming ground: the shipped models on the desk's wording and both hand-written sets.
  const shipped = loadModel(JSON.parse(read('../src/model/model.json')));
  const record = JSON.parse(read('../../ml/reports/bundle_v2_answers.json')) as { sets: Record<string, { file: string; answers: [string, string, string][] }> };
  for (const [name, { file, answers }] of Object.entries(record.sets)) {
    met = report(name, measureAgreement(parseRows(read(`../../ml/data/generated/${file}`)), modelPredict(shipped), chosenTable(answers))) && met;
  }
  console.log(met ? 'BAR MET on every set' : 'BAR NOT MET');
}
