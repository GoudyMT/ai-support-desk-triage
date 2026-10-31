import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON } from '../src/pipeline/run';
import { START_POINT, assertFreshUnseen, checkExitCode, gateFailures, measureSet, parseRows } from './measurePipeline';

const MODEL = loadModel(JSON.parse(readFileSync(fileURLToPath(new URL('../src/model/model.json', import.meta.url)), 'utf8')));
const ROW = { id: 'T-1', text: 'My account was hacked last night', category: 'Security Concern', priority: 'Urgent', mustReview: true };

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
});

describe('the start-point gate', () => {
  // The recorded start point (2026-10-31, after the rule fixes, the fresh set frozen first).
  it('holds the recorded start point', () => {
    expect(START_POINT).toEqual({
      'fold 0': { missed: 10, flagRate: 3587 / 4000, mustReview: 1461 },
      'fold 1': { missed: 6, flagRate: 3536 / 4000, mustReview: 1461 },
      'fold 2': { missed: 10, flagRate: 3509 / 4000, mustReview: 1461 },
      'fold 3': { missed: 46, flagRate: 3570 / 4000, mustReview: 1473 },
      'hand-written (seen)': { missed: 0, flagRate: 32 / 48, mustReview: 22 },
      'hand-written (fresh)': { missed: 0, flagRate: 47 / 60, mustReview: 24 },
    });
  });

  it('runs at floor 0.5 with the second check off (the owner, 2026-10-31)', () => {
    expect(CONFIDENCE_FLOOR).toBe(0.5);
    expect(SECOND_CHECK_ON).toBe(false);
  });

  const START = {
    a: { missed: 2, flagRate: 0.5, mustReview: 4 },
    b: { missed: 0, flagRate: 0.6, mustReview: 3 },
  };
  const at = (name: string, missed: number, flagRate: number, mustReview: number) => ({
    name,
    tickets: 10,
    flagRate,
    highRiskMissed: missed,
    mustReview,
  });

  it('passes sets at or under their start point', () => {
    expect(gateFailures([at('a', 2, 0.5, 4), at('b', 0, 0.4, 3)], START)).toEqual([]);
    expect(checkExitCode([at('a', 2, 0.5, 4)], START)).toBe(0);
  });

  it('fails a set that misses more high-risk tickets than its start point', () => {
    expect(gateFailures([at('a', 3, 0.5, 4), at('b', 1, 0.6, 3)], START)).toEqual(['a', 'b']);
    expect(checkExitCode([at('a', 3, 0.5, 4)], START)).toBe(1);
  });

  // Flagging every ticket would miss nothing; the flag rate is held too.
  it('fails a set that flags a larger share than its start point', () => {
    expect(gateFailures([at('a', 0, 0.51, 4)], START)).toEqual(['a']);
  });

  // Labels dropped on the way in would lower the misses and pass; the count is pinned.
  it('fails a set whose must-review count differs from its start point', () => {
    expect(gateFailures([at('a', 0, 0.5, 3)], START)).toEqual(['a']);
  });

  // A set the start point does not name is never "anything goes".
  it('fails a set with no recorded start point', () => {
    expect(gateFailures([at('c', 0, 0, 0)], START)).toEqual(['c']);
  });

  // A must-review ticket the pipeline does not flag is a miss the gate must see:
  // a confident ordinary prediction with no rule word, labelled must-review here.
  it('counts a must-review ticket the pipeline let through as missed', () => {
    const rows = parseRows(
      JSON.stringify({ id: 'T-2', text: 'Where can I find the export button?', category: 'Billing', priority: 'Medium', mustReview: true }),
    );
    const result = measureSet('probe', MODEL, rows, 0, false);
    expect(result.highRiskMissed).toBe(1);
    expect(result.flagRate).toBe(0);
    expect(result.mustReview).toBe(1);
  });
});

describe('the fresh hand-written set', () => {
  // The clean test set is only clean if no training ticket says the same thing.
  it('refuses a fresh ticket whose text matches a training ticket after normalising', () => {
    const fresh = parseRows(JSON.stringify(ROW));
    expect(() => assertFreshUnseen(fresh, ['my ACCOUNT was hacked, last night!'])).toThrow('E_FRESH_SEEN');
    expect(() => assertFreshUnseen(fresh, ['my account was hacked yesterday'])).not.toThrow();
  });
});
