import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON } from '../src/pipeline/run';
import { START_POINT_MISSES, gateFailures, measureSet, parseRows } from './measurePipeline';

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
  // The owner's start point (2026-10-31): no regression on a fold, none missed by hand.
  it('holds the recorded start point at floor 0.5 with the second check off', () => {
    expect(START_POINT_MISSES).toEqual({ 'fold 0': 9, 'fold 1': 6, 'fold 2': 10, 'fold 3': 46, 'hand-written': 0 });
    expect(CONFIDENCE_FLOOR).toBe(0.5);
    expect(SECOND_CHECK_ON).toBe(false);
  });

  it('fails a set that misses more than its start point, and passes one at or under it', () => {
    const results = [
      { name: 'fold 0', tickets: 10, flagRate: 0.4, highRiskMissed: 9 },
      { name: 'fold 1', tickets: 10, flagRate: 0.3, highRiskMissed: 7 },
      { name: 'fold 3', tickets: 10, flagRate: 0.3, highRiskMissed: 12 },
      { name: 'hand-written', tickets: 10, flagRate: 0.5, highRiskMissed: 1 },
    ];
    expect(gateFailures(results)).toEqual(['fold 1', 'hand-written']);
  });

  // A set the start point does not name has a ceiling of zero, never "anything goes".
  it('treats a set with no recorded start point as allowed no misses', () => {
    expect(gateFailures([{ name: 'fold 9', tickets: 10, flagRate: 0.4, highRiskMissed: 1 }])).toEqual(['fold 9']);
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
  });
});
