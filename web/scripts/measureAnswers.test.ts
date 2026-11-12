import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, type Category, type Priority } from '../src/domain/labels';
import type { SavedAnswer } from '../src/pipeline/tableScorer';
import { measureAnswers } from './measureAnswers';
import type { LabeledRow } from './measurePipeline';

// A question no keyword rule matches, so only the saved answer decides whether a person sees it.
const PLAIN = 'What sizes does the standard desk lamp come in?';
const SURE = 0.95;
const UNSURE = 0.3;
const FLOOR = 0.5;

function spread(classes: readonly string[], chosen: string, share: number): Record<string, number> {
  const rest = (1 - share) / (classes.length - 1);
  return Object.fromEntries(classes.map((name) => [name, name === chosen ? share : rest]));
}

function row(id: string, category: Category, priority: Priority, mustReview: boolean): LabeledRow {
  return { id, text: PLAIN, label: { category, priority, mustReview } };
}

function saved(id: string, category: Category, priority: Priority, share = SURE): SavedAnswer {
  return { id, category_probs: spread(CATEGORIES, category, share), priority_probs: spread(PRIORITIES, priority, share) };
}

describe('measuring the pipeline on saved answers', () => {
  it('counts a High ticket that leaves unchecked as Low, and a high-risk ticket nobody saw', () => {
    const rows = [row('a', 'Account Access', 'High', false), row('b', 'Security Concern', 'Urgent', true)];
    const answers = [saved('a', 'Product Question', 'Low'), saved('b', 'Product Question', 'Low')];
    const result = measureAnswers(rows, answers, FLOOR);
    expect(result).toMatchObject({ tickets: 2, flagged: 0, highUrgentOutLow: 2, highRiskMissed: 1, mustReview: 1, silentCategory: 2, silentPriority: 2 });
  });

  it('counts nothing against a wrong answer that a person checked', () => {
    const rows = [row('a', 'Account Access', 'High', false)];
    const result = measureAnswers(rows, [saved('a', 'Product Question', 'Low', UNSURE)], FLOOR);
    expect(result).toMatchObject({ flagged: 1, highUrgentOutLow: 0, silentCategory: 0, silentPriority: 0 });
  });

  it('does not count a Low ticket called High: a ticket sent up is checked sooner, not lost', () => {
    const rows = [row('a', 'Product Question', 'Low', false)];
    const result = measureAnswers(rows, [saved('a', 'Product Question', 'High')], FLOOR);
    expect(result).toMatchObject({ flagged: 0, highUrgentOutLow: 0, silentPriority: 1 });
  });

  it('counts a right answer that left unchecked as no error at all', () => {
    const rows = [row('a', 'Product Question', 'Low', false)];
    const result = measureAnswers(rows, [saved('a', 'Product Question', 'Low')], FLOOR);
    expect(result).toMatchObject({ flagged: 0, highUrgentOutLow: 0, highRiskMissed: 0, silentCategory: 0, silentPriority: 0 });
  });

  it('stops when a ticket has no saved answer', () => {
    expect(() => measureAnswers([row('a', 'Other', 'Low', false)], [], FLOOR)).toThrow('E_ANSWER_MISSING');
  });
});
