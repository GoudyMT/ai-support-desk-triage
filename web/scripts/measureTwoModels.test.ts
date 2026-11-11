import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, type Category, type Priority } from '../src/domain/labels';
import type { SavedAnswer } from '../src/pipeline/tableScorer';
import type { LabeledRow } from './measurePipeline';
import { measureTwoModels } from './measureTwoModels';

// A question no keyword rule matches, so only the two models decide what happens to it.
const PLAIN = 'What sizes does the standard desk lamp come in?';
const SURE = 0.95;
const UNSURE = 0.3;
const FLOOR = 0.5;

function spread(classes: readonly string[], chosen: string, share: number): Record<string, number> {
  const rest = (1 - share) / (classes.length - 1);
  return Object.fromEntries(classes.map((name) => [name, name === chosen ? share : rest]));
}

function row(id: string, category: Category, priority: Priority, mustReview = false): LabeledRow {
  return { id, text: PLAIN, label: { category, priority, mustReview } };
}

function saved(id: string, category: Category, priority: Priority, share = SURE): SavedAnswer {
  return { id, category_probs: spread(CATEGORIES, category, share), priority_probs: spread(PRIORITIES, priority, share) };
}

describe('the gate model and the answer model together', () => {
  it('lets a ticket leave unchecked only when the gate allows it and both models give the same answer', () => {
    const rows = [row('same', 'Product Question', 'Low'), row('differ', 'Billing', 'Medium'), row('unsure', 'Product Question', 'Low')];
    const gate = [saved('same', 'Product Question', 'Low'), saved('differ', 'Product Question', 'Low'), saved('unsure', 'Product Question', 'Low', UNSURE)];
    const answer = [saved('same', 'Product Question', 'Low'), saved('differ', 'Billing', 'Medium'), saved('unsure', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.today.flagged).toBe(1);
    expect(result.both.flagged).toBe(2);
    expect(result.both).toMatchObject({ silentCategory: 0, silentPriority: 0 });
    // Today the "differ" ticket left unchecked with the gate model's wrong answer.
    expect(result.today).toMatchObject({ silentCategory: 1, silentPriority: 1 });
  });

  it('never releases a ticket on the answer model alone, however sure it is', () => {
    const rows = [row('a', 'Security Concern', 'Urgent', true)];
    const gate = [saved('a', 'Product Question', 'Low', UNSURE)];
    const answer = [saved('a', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.both).toMatchObject({ flagged: 1, highRiskMissed: 0, highUrgentOutLow: 0 });
  });

  it('counts a miss both models agree on, the one kind of error the pair cannot catch', () => {
    const rows = [row('a', 'Account Access', 'High')];
    const wrong = [saved('a', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, wrong, wrong, FLOOR);
    expect(result.both).toMatchObject({ flagged: 0, highUrgentOutLow: 1, silentCategory: 1, silentPriority: 1 });
    expect(result.both).toEqual(result.today);
  });

  it('reports how often each model shows the reviewer the right answer on the tickets a person sees', () => {
    const rows = [row('a', 'Billing', 'Medium'), row('b', 'Account Access', 'High')];
    const gate = [saved('a', 'Product Question', 'Low', UNSURE), saved('b', 'Account Access', 'Low', UNSURE)];
    const answer = [saved('a', 'Billing', 'Medium'), saved('b', 'Account Access', 'Medium')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.reviewed).toBe(2);
    expect(result.suggestion.gate).toEqual({ category: 1, priority: 0, both: 0 });
    expect(result.suggestion.answer).toEqual({ category: 2, priority: 1, both: 1 });
  });

  it('stops when either model has no answer for a ticket', () => {
    const rows = [row('a', 'Other', 'Low')];
    expect(() => measureTwoModels(rows, [saved('a', 'Other', 'Low')], [], FLOOR)).toThrow('E_ANSWER_MISSING');
    expect(() => measureTwoModels(rows, [], [saved('a', 'Other', 'Low')], FLOOR)).toThrow('E_ANSWER_MISSING');
  });
});
