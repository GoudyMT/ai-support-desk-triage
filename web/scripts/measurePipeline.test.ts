import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModel } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON } from '../src/pipeline/run';
import { assertFreshUnseen, checkExitCode, gateFailures, loadSets, main, measureSet, parseRows } from './measurePipeline';

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
    expect(main(['--folds', 'unused', '--check'], load, { probe: point })).toBe(0);
    expect(main(['--folds', 'unused', '--check'], load, { probe: { ...point, mustReview: 2 } })).toBe(1);
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
