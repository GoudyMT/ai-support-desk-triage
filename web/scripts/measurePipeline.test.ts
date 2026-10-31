import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/model/scorer';
import { gateFailures, measureSet, parseRows } from './measurePipeline';

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

describe('the zero-missed gate', () => {
  it('fails exactly the sets that missed a high-risk ticket', () => {
    const results = [
      { name: 'fold 0', tickets: 10, flagRate: 0.4, highRiskMissed: 0 },
      { name: 'fold 1', tickets: 10, flagRate: 0.3, highRiskMissed: 2 },
      { name: 'hand-written', tickets: 10, flagRate: 0.5, highRiskMissed: 1 },
    ];
    expect(gateFailures(results)).toEqual(['fold 1', 'hand-written']);
    expect(gateFailures(results.slice(0, 1))).toEqual([]);
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
