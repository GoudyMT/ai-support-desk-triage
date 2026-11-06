import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRow } from '../src/history/view';
import { loadModel } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON } from '../src/pipeline/run';
import { createDeskSchedule } from '../src/run/clock';
import { createRun } from '../src/run/engine';
import { canQuickApprove } from '../src/run/engineParts';
import { createPrescreener } from '../src/run/prescreen';
import {
  approveCardsPerRun,
  assertFreshUnseen,
  checkExitCode,
  checkHistory,
  evalNumbers,
  gateFailures,
  historyFailures,
  loadSets,
  main,
  measureSet,
  parseRows,
} from './measurePipeline';

const MODEL_TEXT = readFileSync(fileURLToPath(new URL('../src/model/model.json', import.meta.url)), 'utf8');
const MODEL = loadModel(JSON.parse(MODEL_TEXT));
const ROW = { id: 'T-1', text: 'My account was hacked last night', category: 'Security Concern', priority: 'Urgent', mustReview: true };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseRows', () => {
  it('reads the label fields the gate counts misses from', () => {
    expect(parseRows(`${JSON.stringify(ROW)}\n\n`)).toEqual([
      { id: 'T-1', text: ROW.text, label: { category: 'Security Concern', priority: 'Urgent', mustReview: true } },
    ]);
  });

  // The CI gate must never pass because a renamed field was read as "not high-risk".
  it('refuses a row whose must-review flag is missing or not a boolean', () => {
    expect(() => parseRows(JSON.stringify({ ...ROW, mustReview: undefined }))).toThrow('E_BAD_ROW');
    expect(() => parseRows(JSON.stringify({ ...ROW, mustReview: 'yes' }))).toThrow('E_BAD_ROW');
  });

  it('refuses a category or priority outside the label lists', () => {
    expect(() => parseRows(JSON.stringify({ ...ROW, category: 'Security' }))).toThrow('E_BAD_ROW');
    expect(() => parseRows(JSON.stringify({ ...ROW, priority: 'Critical' }))).toThrow('E_BAD_ROW');
  });

  // Truth is looked up by id: a second row under the same id would replace the
  // first row's label, and a must-review miss would vanish from the count.
  it('refuses two rows with the same id', () => {
    const lines = [JSON.stringify(ROW), JSON.stringify({ ...ROW, mustReview: false })].join('\n');
    expect(() => parseRows(lines)).toThrow('E_DUPLICATE_ID');
  });
});

describe('the start-point gate', () => {
  it('runs at floor 0.5 with the second check off (the owner, 2026-10-31)', () => {
    expect(CONFIDENCE_FLOOR).toBe(0.5);
    expect(SECOND_CHECK_ON).toBe(false);
  });

  const START = {
    a: { tickets: 10, missed: 2, flagRate: 0.5, mustReview: 4 },
    b: { tickets: 10, missed: 0, flagRate: 0.6, mustReview: 3 },
  };
  const at = (name: string, missed: number, flagRate: number, mustReview: number, tickets = 10) => ({
    name,
    tickets,
    flagRate,
    highRiskMissed: missed,
    mustReview,
  });
  const B_HELD = at('b', 0, 0.6, 3);

  it('passes sets at or under their start point', () => {
    expect(gateFailures([at('a', 2, 0.5, 4), at('b', 0, 0.4, 3)], START)).toEqual([]);
    expect(checkExitCode([at('a', 2, 0.5, 4), B_HELD], START)).toBe(0);
  });

  it('fails a set that misses more high-risk tickets than its start point', () => {
    expect(gateFailures([at('a', 3, 0.5, 4), at('b', 1, 0.6, 3)], START)).toEqual(['a', 'b']);
    expect(checkExitCode([at('a', 3, 0.5, 4), B_HELD], START)).toBe(1);
  });

  // Flagging every ticket would miss nothing; the flag rate is held too.
  it('fails a set that flags a larger share than its start point', () => {
    expect(gateFailures([at('a', 0, 0.51, 4), B_HELD], START)).toEqual(['a']);
  });

  // Labels dropped or added on the way in would change what counts as a miss.
  it('fails a set whose must-review count differs from its start point', () => {
    expect(gateFailures([at('a', 0, 0.5, 3), B_HELD], START)).toEqual(['a']);
    expect(gateFailures([at('a', 0, 0.5, 5), B_HELD], START)).toEqual(['a']);
  });

  // Dropping ordinary tickets raises nothing the other numbers would catch.
  it('fails a set whose ticket count differs from its start point', () => {
    expect(gateFailures([at('a', 2, 0.5, 4, 9), B_HELD], START)).toEqual(['a']);
  });

  // A set the start point does not name is never "anything goes".
  it('fails a set with no recorded start point', () => {
    expect(gateFailures([at('a', 2, 0.5, 4), B_HELD, at('c', 0, 0, 0)], START)).toEqual(['c']);
  });

  // A set that never loaded must fail, or losing the worst fold would pass.
  it('fails when a set in the start point has no result', () => {
    expect(gateFailures([at('a', 2, 0.5, 4)], START)).toEqual(['b']);
    expect(gateFailures([], START)).toEqual(['a', 'b']);
  });

  // A must-review ticket the pipeline does not flag is a miss the gate must see:
  // a confident ordinary prediction with no rule word, labelled must-review here.
  // The ordinary row beside it keeps the must-review count apart from the row count.
  it('counts a must-review ticket the pipeline let through as missed', () => {
    const rows = parseRows(
      [
        JSON.stringify({ id: 'T-2', text: 'Where can I find the export button?', category: 'Billing', priority: 'Medium', mustReview: true }),
        JSON.stringify({ id: 'T-3', text: 'Where can I find the export button?', category: 'Product Question', priority: 'Low', mustReview: false }),
      ].join('\n'),
    );
    const result = measureSet('probe', MODEL, rows, 0, false);
    expect(result.highRiskMissed).toBe(1);
    expect(result.flagRate).toBe(0);
    expect(result.mustReview).toBe(1);
    expect(result.tickets).toBe(2);
  });

  // CI reads the command's exit code, so the --check path itself must fail on a
  // broken set, not only the helper it calls.
  it('exits 1 from --check when a set breaks its start point and 0 when it holds', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rows = parseRows(JSON.stringify(ROW));
    const load = () => [{ name: 'probe', model: MODEL, rows }];
    const held = measureSet('probe', MODEL, rows, CONFIDENCE_FLOOR, SECOND_CHECK_ON);
    const point = { tickets: held.tickets, missed: held.highRiskMissed, flagRate: held.flagRate, mustReview: held.mustReview };
    expect(main(['--folds', 'unused', '--check'], load, { probe: point }, HISTORY_HOLDS)).toBe(0);
    expect(main(['--folds', 'unused', '--check'], load, { probe: { ...point, mustReview: 2 } }, HISTORY_HOLDS)).toBe(1);
  });
});

const HISTORY_HOLDS = () => ({ approve: 0, failures: [] });
const FRESH_POINT = { tickets: 60, missed: 0, flagRate: 47 / 60, mustReview: 24 };
const CURRENT: HistoryRow = {
  id: 'baseline',
  name: 'Baseline model (current)',
  kind: 'Word weights plus safety rules',
  heldOutRight: 0.573,
  handWrittenRight: { k: 39, n: 48 },
  highRiskMissed: { k: 0, n: 24 },
  sentToPerson: 0.78,
  approveCardsPerRun: 12.3,
};
const EVALUATED = { heldOutRight: 0.573, handWrittenRight: { k: 39, n: 48 } };

// The history page shows what the history file says, so a number there that CI does not measure would be a made-up
// claim on the page.
describe('the history check', () => {
  it('passes when the current row equals the evaluation, the fresh-set start point and the Approve count', () => {
    expect(historyFailures(CURRENT, EVALUATED, FRESH_POINT, 12.3)).toEqual([]);
    // The measured count is held to one decimal.
    expect(historyFailures(CURRENT, EVALUATED, FRESH_POINT, 12.34)).toEqual([]);
  });

  it.each([
    ['held-out accuracy up', { heldOutRight: 0.574 }, 'E_HISTORY_HELD_OUT'],
    ['held-out accuracy down', { heldOutRight: 0.572 }, 'E_HISTORY_HELD_OUT'],
    ['hand-written right', { handWrittenRight: { k: 40, n: 48 } }, 'E_HISTORY_HAND'],
    ['hand-written set size', { handWrittenRight: { k: 39, n: 49 } }, 'E_HISTORY_HAND'],
    ['high-risk missed', { highRiskMissed: { k: 1, n: 24 } }, 'E_HISTORY_MISSED'],
    ['high-risk missed, not measured', { highRiskMissed: null }, 'E_HISTORY_MISSED'],
    ['sent to a person', { sentToPerson: 0.79 }, 'E_HISTORY_SENT'],
    ['Approve cards per run', { approveCardsPerRun: 12.4 }, 'E_HISTORY_APPROVE'],
  ])('fails with its code when the row changes %s', (_name, change, code) => {
    expect(historyFailures({ ...CURRENT, ...change }, EVALUATED, FRESH_POINT, 12.3)).toEqual([code]);
  });

  it('reads the numbers it compares with from the evaluation report, and refuses a report without them', () => {
    const report = { summary: { model_category: { mean: 0.573 } }, handwritten: { model_category: { k: 39, n: 48 } } };
    expect(evalNumbers(report)).toEqual(EVALUATED);
    expect(() => evalNumbers({ summary: {} })).toThrow('E_EVAL_SHAPE');
  });

  // CI reads the exit code: a failing history must fail the command the same way a broken set does.
  it('exits 1 from --check, naming the code, when the history differs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rows = parseRows(JSON.stringify(ROW));
    const held = measureSet('probe', MODEL, rows, CONFIDENCE_FLOOR, SECOND_CHECK_ON);
    const point = { tickets: held.tickets, missed: held.highRiskMissed, flagRate: held.flagRate, mustReview: held.mustReview };
    const sets = () => [{ name: 'probe', model: MODEL, rows }];
    const broken = () => ({ approve: 12.3, failures: ['E_HISTORY_SENT'] });
    expect(main(['--folds', 'unused', '--check'], sets, { probe: point }, broken)).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('E_HISTORY_SENT');
  });

  const served = (history: HistoryRow[]): Record<string, string> => ({
    'history.json': JSON.stringify(history),
    'eval.json': JSON.stringify({ summary: { model_category: { mean: 0.573 } }, handwritten: { model_category: { k: 39, n: 48 } } }),
    'fold_0.json': MODEL_TEXT,
    'fold_1.json': MODEL_TEXT,
    'fold_2.json': MODEL_TEXT,
    'fold_3.json': MODEL_TEXT,
  });
  const readFrom = (files: Record<string, string>) => (path: string) => {
    const text = files[basename(path)];
    if (text === undefined) throw new Error('E_TEST_NO_FILE');
    return text;
  };

  it('reads the first history row as the current one and the fresh set as the real start point', () => {
    const approve = approveCardsPerRun(() => MODEL, 2000, 1);
    const row = { ...CURRENT, approveCardsPerRun: Number(approve.toFixed(1)) };
    expect(checkHistory('folds', readFrom(served([row, { ...CURRENT, id: 'old', heldOutRight: 0.1 }])), 1).failures).toEqual([]);
    const moved = { ...row, sentToPerson: 0.5 };
    expect(checkHistory('folds', readFrom(served([moved])), 1).failures).toEqual(['E_HISTORY_SENT']);
    expect(() => checkHistory('folds', readFrom(served([])), 1)).toThrow('E_HISTORY_SHAPE');
  });
});

describe('Approve cards per run', () => {
  // The desk offers Approve on a flagged card the model is at least 70% sure of. With no viewer, every ticket the
  // pipeline flags ends in the done list with that same confidence, so a run's count is countable a second way.
  it('counts each flagged ticket at the cutoff once, as the average over the seeds', () => {
    const SEEDS = [2000, 2001];
    const counts = SEEDS.map((seed) => {
      const run = createRun({
        seed,
        model: MODEL,
        schedule: createDeskSchedule(seed),
        wallClock: () => 0,
        prescreen: createPrescreener(MODEL),
        closeEveryMs: 2500,
        deepTickets: 0,
        timed: false,
      });
      run.finishNow();
      return run.state().done.filter((trail) => trail.guard.flagged && canQuickApprove(trail)).length;
    });
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(approveCardsPerRun(() => MODEL, 2000, 2)).toBe(counts.reduce((sum, count) => sum + count, 0) / SEEDS.length);
  });
});

describe('loading the sets', () => {
  // Small stand-ins for the data files, served by file name, so the real loader
  // runs without the generated data.
  const line = (id: string, text: string) => JSON.stringify({ ...ROW, id, text });
  const FRESH = [line('F-1', 'my screen reader skips the pay button'), line('F-2', 'someone changed my password')].join('\n');
  const freshSha = (text: string) => createHash('sha256').update(JSON.stringify(parseRows(text))).digest('hex');
  const files = (overrides: Record<string, string> = {}): Record<string, string> => {
    const all: Record<string, string> = {
      'handwritten.jsonl': line('H-1', 'the app crashes on start'),
      'handwritten_fresh.jsonl': FRESH,
      'train_all.jsonl': line('T-9', 'my order never arrived'),
      'model.json': MODEL_TEXT,
    };
    for (let k = 0; k < 4; k += 1) {
      all[`fold_${k}.json`] = JSON.stringify({ ...JSON.parse(MODEL_TEXT), heldOutFold: k });
      all[`heldout_${k}.jsonl`] = line(`G-${k}`, 'where is my invoice');
    }
    return { ...all, ...overrides };
  };
  const reader = (served: Record<string, string>) => (path: string) => {
    const text = served[basename(path)];
    if (text === undefined) throw new Error('E_TEST_NO_FILE');
    return text;
  };

  it('loads every fold and both hand-written sets, in order', () => {
    const names = loadSets('folds', reader(files()), freshSha(FRESH)).map((set) => set.name);
    expect(names).toEqual(['fold 0', 'fold 1', 'fold 2', 'fold 3', 'hand-written (seen)', 'hand-written (fresh)']);
  });

  // The clean test set is only clean if no training ticket says the same thing.
  it('refuses a fresh ticket whose text matches a training ticket', () => {
    const served = files({ 'train_all.jsonl': line('T-9', 'Someone changed my password!') });
    expect(() => loadSets('folds', reader(served), freshSha(FRESH))).toThrow('E_FRESH_SEEN');
  });

  // A fold model that trained on the fold it scores would miss less and pass.
  it('refuses a fold file that holds out a different fold', () => {
    const served = files({ 'fold_0.json': JSON.stringify({ ...JSON.parse(MODEL_TEXT), heldOutFold: 1 }) });
    expect(() => loadSets('folds', reader(served), freshSha(FRESH))).toThrow('E_WRONG_FOLD');
  });

  // The fresh set was frozen by the owner; a swapped or relabelled ticket that
  // keeps the counts would still pass the gate.
  it('refuses a fresh set that differs from the frozen one', () => {
    const changed = [line('F-1', 'my screen reader skips the pay button'), line('F-2', 'someone reset my password')].join('\n');
    expect(() => loadSets('folds', reader(files({ 'handwritten_fresh.jsonl': changed })), freshSha(FRESH))).toThrow(
      'E_FRESH_CHANGED',
    );
  });
});

describe('the fresh hand-written set', () => {
  it('matches a training ticket after normalising, and not when the words differ', () => {
    const fresh = parseRows(JSON.stringify(ROW));
    expect(() => assertFreshUnseen(fresh, ['my ACCOUNT was hacked, last night!'])).toThrow('E_FRESH_SEEN');
    expect(() => assertFreshUnseen(fresh, ['my account was hacked yesterday'])).not.toThrow();
  });
});
