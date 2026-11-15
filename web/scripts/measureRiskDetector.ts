import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModel, score } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith, type Predict } from '../src/pipeline/run';
import type { Reviewer } from '../src/pipeline/types';
import { isRunAsCommand } from './exportDataset';
import { measureSplit, parseRiskRows, type Answer, type SplitCounts, type SplitLines } from './measureSplit';

// The risk detector (B1, ml/triage_v2/risk_detector.py) tried on the three-path desk. Per judged set, its cut-off is
// the highest at which, on the tuning side (a fifth of that set's training tickets, held back from the detector and
// from a word model fitted beside it), the word rules, the checked departments and the detector miss no more risky
// tickets than the rules, the departments and the word model's doubt. Then each set is judged once against the bar
// written in the design (section 9) before any number: no line worse than the three-path desk, fewer false marks.
// Writes ml/reports/risk_detector.json. Run from the project root: npm --prefix web run measure-risk-detector

export interface TuneRow {
  risky: boolean;
  // A word rule other than the vague one, or an always-checked department.
  flagged: boolean;
  // The word model under the confidence floor.
  doubt: boolean;
  // The detector's yes-probability.
  p: number;
}

const STEPS = 100;
// The allowance on unchecked wrong answers (design section 4): 0.25% of a set, rounded down, never less than 1.
const ALLOWANCE_SHARE = 0.0025;
const NO_WORSE = ['riskyMissed', 'highOutLow', 'markedWrongTeam', 'markedWrongTeamRisky', 'vagueDirect'] as const;
const ALLOWED = ['uncheckedWrongDept', 'uncheckedWrongPriority'] as const;

/**
 * The highest cut-off, in hundredths, at which the detector misses no more risky tuning tickets than the doubt did.
 *
 * Args:
 *   rows: the tuning tickets.
 *
 * Returns:
 *   The cut-off; 0 marks every ticket, so one always exists.
 */
export function chooseThreshold(rows: readonly TuneRow[]): number {
  const missedByDoubt = rows.filter((row) => row.risky && !row.flagged && !row.doubt).length;
  for (let step = STEPS; step >= 0; step -= 1) {
    const cut = step / STEPS;
    if (rows.filter((row) => row.risky && !row.flagged && row.p < cut).length <= missedByDoubt) return cut;
  }
  return 0;
}

/**
 * Names each line on which the detector's desk fails the bar against the three-path desk.
 *
 * Args:
 *   a: the three-path desk's lines.
 *   b: the same set with the detector in place of the doubt.
 *   tickets: the set's size, for the allowance.
 *
 * Returns:
 *   The failing lines; empty when the detector passes on this set.
 */
export function bBreaches(a: SplitLines, b: SplitLines, tickets = 0): string[] {
  const allowance = Math.max(1, Math.floor(tickets * ALLOWANCE_SHARE));
  const failing: string[] = NO_WORSE.filter((line) => b[line] > a[line]);
  failing.push(...ALLOWED.filter((line) => b[line] - a[line] > allowance));
  if (b.falseMarks >= a.falseMarks) failing.push('falseMarks');
  return failing;
}

const REPORTS = new URL('../../ml/reports/', import.meta.url);
const GENERATED = new URL('../../ml/data/generated/', import.meta.url);
const RISK_DIR = new URL('../../ml/data/generated/risk/', import.meta.url);
const TAKES_SUGGESTION: Reviewer = { decide: (input) => ({ ...input.suggestion, route: '' }) };

type AnswerList = readonly (readonly [string, string, string])[];
interface Scores {
  train: string;
  tune_ids: string[];
  tune_scores: [string, number][];
  judged_scores: [string, number][];
}

function wordOf(url: URL): Predict {
  const model = loadModel(JSON.parse(readFileSync(url, 'utf8')));
  return (head, maskedText) => score(model, head, maskedText);
}

function tuneRows(scores: Scores, word: Predict): TuneRow[] {
  const held = new Set(scores.tune_ids);
  const p = new Map(scores.tune_scores);
  const settings = { reviewer: TAKES_SUGGESTION, floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  return parseRiskRows(readFileSync(new URL(scores.train, GENERATED), 'utf8'))
    .filter((row) => held.has(row.id))
    .map((row) => {
      const reasons = runTicketWith(row.text, row.id, word, settings).guard.reasons;
      return {
        risky: row.label.mustReview && row.reviewReason !== 'vague ticket',
        flagged: reasons.some((reason) => (reason.kind === 'rule' && reason.reason !== 'vague ticket') || reason.kind === 'category'),
        doubt: reasons.some((reason) => reason.kind === 'low confidence'),
        p: p.get(row.id) ?? Number.NaN,
      };
    });
}

function main(): number {
  const record = JSON.parse(readFileSync(new URL('bundle_v2_answers.json', REPORTS), 'utf8')) as { sets: Record<string, { file: string; answers: AnswerList }> };
  const folds = JSON.parse(readFileSync(new URL('sentence_fold_answers.json', REPORTS), 'utf8')) as Record<string, { answers: AnswerList }>;
  const recorded = JSON.parse(readFileSync(new URL('split_flow.json', REPORTS), 'utf8')) as { sets: Record<string, SplitCounts> };
  const judged: Record<string, { file: string; word: URL; answers: AnswerList }> = {};
  for (const [name, { file, answers }] of Object.entries(record.sets)) judged[name] = { file, word: new URL('../src/model/model.json', import.meta.url), answers };
  for (const [fold, { answers }] of Object.entries(folds)) judged[`fold ${fold}`] = { file: `heldout_${fold}.jsonl`, word: new URL(`../public/models/fold_${fold}.json`, import.meta.url), answers };
  const sets: Record<string, unknown> = {};
  let passed = true;
  for (const [name, { file, word, answers }] of Object.entries(judged)) {
    const stem = name.replace(' ', '_');
    const scores = JSON.parse(readFileSync(new URL(`${stem}_scores.json`, RISK_DIR), 'utf8')) as Scores;
    const cut = chooseThreshold(tuneRows(scores, wordOf(new URL(`${stem}_tune_model.json`, RISK_DIR))));
    const p = new Map(scores.judged_scores);
    const rows = parseRiskRows(readFileSync(new URL(file, GENERATED), 'utf8'));
    const said = new Map(answers.map(([id, category, priority]) => [id, { category, priority } as Answer]));
    const sentence = (id: string): Answer => {
      const answer = said.get(id);
      if (answer === undefined) throw new Error('E_ANSWER_SET');
      return answer;
    };
    const b = measureSplit(rows, wordOf(word), sentence, (id) => {
      const yes = p.get(id);
      if (yes === undefined) throw new Error('E_NO_SCORE');
      return yes >= cut;
    });
    const a = recorded.sets[name]?.split;
    if (a === undefined) throw new Error('E_REPORT_SHAPE');
    const failing = bBreaches(a, b.split, rows.length);
    passed &&= failing.length === 0;
    sets[name] = { cut, a, b: b.split, failing };
    console.log(`${name}: cut ${cut}; false marks ${a.falseMarks} -> ${b.split.falseMarks}; risky missed ${a.riskyMissed} -> ${b.split.riskyMissed}; ${failing.length === 0 ? 'PASS' : `FAIL ${failing.join(', ')}`}`);
  }
  const out = new URL('risk_detector.json', REPORTS);
  writeFileSync(out, `${JSON.stringify({ verdict: passed ? 'passed' : 'not passed', sets }, null, 1)}\n`, 'utf8');
  console.log(`${passed ? 'PASSED' : 'NOT PASSED'} - wrote ${fileURLToPath(out)}`);
  return 0;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main();
}
