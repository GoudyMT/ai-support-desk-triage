import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, ROUTES } from '../domain/labels';
import { runTicketWith } from './run';
import { tablePredict, type SavedAnswer } from './tableScorer';
import type { ReviewDecision, ReviewInput } from './types';

// A question no keyword rule matches, so only the saved answer decides what happens to it.
const PLAIN_QUESTION = 'What sizes does the standard desk lamp come in?';
const SURE = 0.92;

function spread(classes: readonly string[], chosen: string, share: number): Record<string, number> {
  const rest = (1 - share) / (classes.length - 1);
  return Object.fromEntries(classes.map((name) => [name, name === chosen ? share : rest]));
}

function answer(id: string, category: string, priority: string, share = SURE): SavedAnswer {
  return { id, category_probs: spread(CATEGORIES, category, share), priority_probs: spread(PRIORITIES, priority, share) };
}

const REVIEWER = {
  decide(input: ReviewInput): ReviewDecision {
    return { ...input.suggestion, route: ROUTES[input.suggestion.category], reason: 'kept' };
  },
};
const SETTINGS = { reviewer: REVIEWER, floor: 0.5, secondCheckOn: false, now: () => 0 };

describe('a scorer that reads saved answers', () => {
  const predict = tablePredict([answer('t1', 'Billing', 'Medium'), answer('t2', 'Product Question', 'Low')]);

  it("gives a ticket its own saved answer: the likeliest class and that class's probability", () => {
    const category = predict('category', 'ignored text', 't1');
    expect(category.label).toBe('Billing');
    expect(category.confidence).toBeCloseTo(SURE);
    expect(Object.keys(category.probabilities).sort()).toEqual([...CATEGORIES].sort());
    expect(predict('priority', 'ignored text', 't2').label).toBe('Low');
  });

  it('refuses a ticket it holds no answer for, so none is ever scored with a made-up one', () => {
    expect(() => predict('category', PLAIN_QUESTION, 'unknown')).toThrow('E_ANSWER_MISSING');
  });

  it('refuses a table whose answer leaves a class out or repeats a ticket', () => {
    const noBilling = answer('t3', 'Other', 'Low');
    delete noBilling.category_probs['Billing'];
    expect(() => tablePredict([noBilling])).toThrow('E_ANSWER_SHAPE');
    expect(() => tablePredict([answer('t4', 'Other', 'Low'), answer('t4', 'Billing', 'High')])).toThrow('E_ANSWER_SHAPE');
  });

  it('lets the pipeline run a ticket on the saved answer with no model at all', () => {
    const trail = runTicketWith(PLAIN_QUESTION, 't1', predict, SETTINGS);
    expect(trail.guard.flagged).toBe(false);
    expect(trail.final).toEqual({ category: 'Billing', priority: 'Medium', route: ROUTES.Billing, by: 'model' });
  });
});
