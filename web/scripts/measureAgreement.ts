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
//
// The partial lift (the owner's pick, 2026-11-14, after the full lift failed): agreement lets a ticket out only when
// the word model is at least `liftFrom` sure. The rule for choosing it, written before any number of it existed: try
// 0.45 down to 0.05 in steps of 0.05 on the four held-out folds only; take the lowest that meets the bar on all four;
// if none does, the partial lift is not adopted. The chosen setting is then measured once on the desk wording and both
// hand-written sets, which must meet the bar too.

export const LIFT_STEPS = [0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05];
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
export function measureAgreement(rows: readonly LabeledRow[], gatePredict: Predict, answerPredict: Predict, liftFrom = NO_FLOOR): AgreementResult {
  const today = measureTwoPredictors(rows, gatePredict, answerPredict).both;
  const lifted = emptyResult(rows.length);
  const base = { reviewer: AGREEING_REVIEWER as never, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  for (const row of rows) {
    // The word model run with its floor lowered to `liftFrom`: still flagged by a rule, an always-checked department or
    // being under that lower floor.
    const unfloored = runTicketWith(row.text, row.id, gatePredict, { ...base, floor: liftFrom });
    const answer = runTicketWith(row.text, row.id, answerPredict, { ...base, floor: NO_FLOOR });
    lifted.mustReview += row.label.mustReview ? 1 : 0;
    const agree = !answer.guard.flagged && answer.final.category === unfloored.final.category && answer.final.priority === unfloored.final.priority;
    if (agree && !unfloored.guard.flagged) {
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

/**
 * Picks the partial lift by the rule above, from each step's results on the four folds.
 *
 * Args:
 *   byStep: for each lift setting, its results on every fold.
 *
 * Returns:
 *   The lowest setting that meets the bar on every fold, or null when none does.
 */
export function chooseLift(byStep: ReadonlyMap<number, readonly AgreementResult[]>): number | null {
  const passing = [...byStep].filter(([, folds]) => folds.length > 0 && folds.every((fold) => judge(fold).met)).map(([step]) => step);
  return passing.length === 0 ? null : Math.min(...passing);
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
  const folds = Object.entries(JSON.parse(read('../../ml/reports/sentence_fold_answers.json')) as Record<string, { answers: [string, string, string][] }>).map(
    ([fold, { answers }]) => ({
      fold,
      rows: parseRows(read(`../../ml/data/generated/heldout_${fold}.jsonl`)),
      word: modelPredict(loadModel(JSON.parse(read(`../public/models/fold_${fold}.json`)))),
      sentence: chosenTable(answers),
    }),
  );
  // The first try, recorded for the note: the whole floor lifted when the models agree. It is not a step to choose.
  console.log('-- full lift (the first try)');
  for (const { fold, rows, word, sentence } of folds) report(`fold ${fold}`, measureAgreement(rows, word, sentence));
  const byStep = new Map<number, AgreementResult[]>();
  for (const step of LIFT_STEPS) {
    console.log(`-- lift from ${step}`);
    byStep.set(step, folds.map(({ fold, rows, word, sentence }) => {
      const result = measureAgreement(rows, word, sentence, step);
      report(`fold ${fold}`, result);
      return result;
    }));
  }
  const chosen = chooseLift(byStep);
  if (chosen === null) {
    console.log('NO SETTING meets the bar on all four folds: the partial lift is not adopted');
  } else {
    // Confirming ground, measured once, at the chosen setting only.
    console.log(`CHOSEN on the folds: lift from ${chosen}`);
    const shipped = modelPredict(loadModel(JSON.parse(read('../src/model/model.json'))));
    const record = JSON.parse(read('../../ml/reports/bundle_v2_answers.json')) as { sets: Record<string, { file: string; answers: [string, string, string][] }> };
    let met = true;
    for (const [name, { file, answers }] of Object.entries(record.sets)) {
      met = report(name, measureAgreement(parseRows(read(`../../ml/data/generated/${file}`)), shipped, chosenTable(answers), chosen)) && met;
    }
    console.log(met ? 'CONFIRMED: the bar is met on every set' : 'NOT CONFIRMED on the desk and hand-written sets');
  }
}
