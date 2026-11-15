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
// With --write (from the project root: npm --prefix web run measure-risk-detector -- --write) it reads the
// detector's scores, which only the Python run makes and which are not committed, and writes
// ml/reports/risk_detector.json with the tickets the detector said yes to on each set. With --check (CI) it works
// every published line, failing line and the verdict out again from those tickets; the cut-off itself is recorded,
// not worked out again.

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

// Each judged set's training file, as ml/triage_v2/risk_detector.py splits it: never taken from the scores file.
const TRAIN_FILES: Record<string, string> = {
  desk: 'train_all.jsonl',
  handwritten: 'train_all.jsonl',
  fresh: 'train_all.jsonl',
  'fold 0': 'train_0.jsonl',
  'fold 1': 'train_1.jsonl',
  'fold 2': 'train_2.jsonl',
  'fold 3': 'train_3.jsonl',
};

// A tuning ticket with no score, or one not found in its training file, stops the run: counted as caught, it would
// push the cut-off up.
function tuneRows(name: string, scores: Scores, word: Predict): TuneRow[] {
  const train = TRAIN_FILES[name];
  if (train === undefined || train !== scores.train) throw new Error('E_TRAIN_FILE');
  const held = new Set(scores.tune_ids);
  const p = new Map(scores.tune_scores);
  const settings = { reviewer: TAKES_SUGGESTION, floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  const rows = parseRiskRows(readFileSync(new URL(train, GENERATED), 'utf8')).filter((row) => held.has(row.id));
  if (rows.length !== held.size) throw new Error('E_NO_SCORE');
  return rows.map((row) => {
    const yes = p.get(row.id);
    if (yes === undefined) throw new Error('E_NO_SCORE');
    const reasons = runTicketWith(row.text, row.id, word, settings).guard.reasons;
    return {
      risky: row.label.mustReview && row.reviewReason !== 'vague ticket',
      flagged: reasons.some((reason) => (reason.kind === 'rule' && reason.reason !== 'vague ticket') || reason.kind === 'category'),
      doubt: reasons.some((reason) => reason.kind === 'low confidence'),
      p: yes,
    };
  });
}

interface SetRecord {
  cut: number;
  // The judged tickets the detector said yes to at the cut-off, sorted.
  yes: string[];
  a: SplitLines;
  b: SplitLines;
  failing: string[];
}

interface DetectorRecord {
  verdict: string;
  sets: Record<string, SetRecord>;
}

/**
 * Names what differs between the committed record and the one worked out again.
 *
 * Args:
 *   recorded: the committed record.
 *   built: the record worked out again.
 *
 * Returns:
 *   'verdict' and each differing or missing set; empty when they match.
 */
export function recordDiffers(recorded: DetectorRecord, built: DetectorRecord): string[] {
  const names = [...new Set([...Object.keys(recorded.sets), ...Object.keys(built.sets)])];
  const differing = names.filter((name) => JSON.stringify(recorded.sets[name]) !== JSON.stringify(built.sets[name]));
  return recorded.verdict === built.verdict ? differing : ['verdict', ...differing];
}

interface JudgedSet {
  file: string;
  word: URL;
  answers: AnswerList;
}

function judgedSets(): Record<string, JudgedSet> {
  const record = JSON.parse(readFileSync(new URL('bundle_v2_answers.json', REPORTS), 'utf8')) as { sets: Record<string, { file: string; answers: AnswerList }> };
  const folds = JSON.parse(readFileSync(new URL('sentence_fold_answers.json', REPORTS), 'utf8')) as Record<string, { answers: AnswerList }>;
  const judged: Record<string, JudgedSet> = {};
  for (const [name, { file, answers }] of Object.entries(record.sets)) judged[name] = { file, word: new URL('../src/model/model.json', import.meta.url), answers };
  for (const [fold, { answers }] of Object.entries(folds)) judged[`fold ${fold}`] = { file: `heldout_${fold}.jsonl`, word: new URL(`../public/models/fold_${fold}.json`, import.meta.url), answers };
  return judged;
}

// Judges one set with the detector's yes in place of the word model's doubt, against the three-path desk's lines.
function judge(name: string, set: JudgedSet, cut: number, yes: (id: string) => boolean): SetRecord {
  const recorded = JSON.parse(readFileSync(new URL('split_flow.json', REPORTS), 'utf8')) as { sets: Record<string, SplitCounts> };
  const rows = parseRiskRows(readFileSync(new URL(set.file, GENERATED), 'utf8'));
  const said = new Map(set.answers.map(([id, category, priority]) => [id, { category, priority } as Answer]));
  const sentence = (id: string): Answer => {
    const answer = said.get(id);
    if (answer === undefined) throw new Error('E_ANSWER_SET');
    return answer;
  };
  const b = measureSplit(rows, wordOf(set.word), sentence, yes);
  const a = recorded.sets[name]?.split;
  if (a === undefined) throw new Error('E_REPORT_SHAPE');
  const saidYes = rows.filter((row) => yes(row.id)).map((row) => row.id).sort();
  return { cut, yes: saidYes, a, b: b.split, failing: bBreaches(a, b.split, rows.length) };
}

function fromScores(): DetectorRecord {
  const sets: Record<string, SetRecord> = {};
  for (const [name, set] of Object.entries(judgedSets())) {
    const stem = name.replace(' ', '_');
    const scores = JSON.parse(readFileSync(new URL(`${stem}_scores.json`, RISK_DIR), 'utf8')) as Scores;
    const cut = chooseThreshold(tuneRows(name, scores, wordOf(new URL(`${stem}_tune_model.json`, RISK_DIR))));
    const p = new Map(scores.judged_scores);
    sets[name] = judge(name, set, cut, (id) => {
      const score = p.get(id);
      if (score === undefined) throw new Error('E_NO_SCORE');
      return score >= cut;
    });
  }
  return { verdict: Object.values(sets).every((set) => set.failing.length === 0) ? 'passed' : 'not passed', sets };
}

function fromRecord(recorded: DetectorRecord): DetectorRecord {
  const sets: Record<string, SetRecord> = {};
  for (const [name, set] of Object.entries(judgedSets())) {
    const entry = recorded.sets[name];
    if (entry === undefined) continue;
    const yes = new Set(entry.yes);
    sets[name] = judge(name, set, entry.cut, (id) => yes.has(id));
  }
  return { verdict: Object.values(sets).every((set) => set.failing.length === 0) ? 'passed' : 'not passed', sets };
}

const RECORD = new URL('risk_detector.json', REPORTS);

function main(args: readonly string[]): number {
  if (args.includes('--write')) {
    const built = fromScores();
    writeFileSync(RECORD, `${JSON.stringify(built, null, 1)}\n`, 'utf8');
    for (const [name, set] of Object.entries(built.sets)) {
      console.log(`${name}: cut ${set.cut}; false marks ${set.a.falseMarks} -> ${set.b.falseMarks}; risky missed ${set.a.riskyMissed} -> ${set.b.riskyMissed}; ${set.failing.length === 0 ? 'PASS' : `FAIL ${set.failing.join(', ')}`}`);
    }
    console.log(`${built.verdict.toUpperCase()} - wrote ${fileURLToPath(RECORD)}`);
    return 0;
  }
  if (!args.includes('--check')) {
    console.log('usage: measureRiskDetector --write | --check');
    return 2;
  }
  const recorded = JSON.parse(readFileSync(RECORD, 'utf8')) as DetectorRecord;
  const differing = recordDiffers(recorded, fromRecord(recorded));
  for (const name of differing) console.log(`FAIL detector record differs: ${name}`);
  if (differing.length === 0) console.log('PASS detector record matches the tickets it said yes to');
  return differing.length === 0 ? 0 : 1;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
