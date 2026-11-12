import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, type Category, type Priority } from '../src/domain/labels';
import { tablePredict, type SavedAnswer } from '../src/pipeline/tableScorer';
import { runWeek, type WeekLabeledRow } from './runWeek';

// A plain shipping question: no rule flags it, so only the models decide.
const PLAIN = 'My parcel has not arrived yet, can you check where it is?';

function row(id: string, day: number, category: Category = 'Shipping/Order Issue', priority: Priority = 'Medium'): WeekLabeledRow {
  return { id, text: PLAIN, day, label: { category, priority, mustReview: false } };
}

function sure(id: string, category: Category, priority: Priority): SavedAnswer {
  const one = (classes: readonly string[], pick: string): Record<string, number> =>
    Object.fromEntries(classes.map((name) => [name, name === pick ? 1 : 0]));
  return { id, category_probs: one(CATEGORIES, category), priority_probs: one(PRIORITIES, priority) };
}

const table = (answers: SavedAnswer[]) => tablePredict(answers);

describe('runWeek', () => {
  it('lets a ticket leave unchecked when the gate allows it and both models agree', () => {
    const rows = [row('a', 1)];
    const agree = [sure('a', 'Shipping/Order Issue', 'Medium')];
    const result = runWeek(rows, table(agree), table(agree), table(agree));
    expect(result.days[0]?.retrained.toPerson).toBe(0);
    expect(result.checked).toEqual([]);
  });

  it('sends a ticket to a person when the retrained model disagrees, and keeps the reviewer answer as its label', () => {
    const rows = [row('a', 1)];
    const gate = [sure('a', 'Shipping/Order Issue', 'Medium')];
    const other = [sure('a', 'Billing', 'Medium')];
    const result = runWeek(rows, table(gate), table(other), table(gate), 0);
    expect(result.days[0]?.retrained.toPerson).toBe(1);
    expect(result.days[0]?.frozen.toPerson).toBe(0);
    expect(result.checked).toEqual([{ id: 'a', maskedText: PLAIN, category: 'Shipping/Order Issue', priority: 'Medium', day: 1 }]);
  });

  it('takes the label from the reviewer, mistakes included, and never from a frozen-only disagreement', () => {
    const rows = [row('a', 2), row('b', 2)];
    const gate = [sure('a', 'Shipping/Order Issue', 'Medium'), sure('b', 'Shipping/Order Issue', 'Medium')];
    const retrained = [sure('a', 'Billing', 'Medium'), sure('b', 'Shipping/Order Issue', 'Medium')];
    const frozen = [sure('a', 'Billing', 'Medium'), sure('b', 'Billing', 'Medium')];
    const result = runWeek(rows, table(gate), table(retrained), table(frozen), 1);
    expect(result.checked.map((c) => c.id)).toEqual(['a']);
    expect(result.checked[0]?.category).not.toBe('Shipping/Order Issue');
    expect(result.checked[0]?.priority).toBe('Medium');
  });

  it('counts each model right or wrong against the true label on every ticket, by day', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 3)];
    const truth = [sure('a', 'Shipping/Order Issue', 'Medium'), sure('b', 'Shipping/Order Issue', 'Medium'), sure('c', 'Shipping/Order Issue', 'Medium')];
    const wrongOnB = [sure('a', 'Shipping/Order Issue', 'Medium'), sure('b', 'Billing', 'High'), sure('c', 'Shipping/Order Issue', 'Medium')];
    const result = runWeek(rows, table(truth), table(truth), table(wrongOnB), 0);
    expect(result.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.days[0]?.retrained).toMatchObject({ tickets: 2, categoryRight: 2, priorityRight: 2 });
    expect(result.days[0]?.frozen).toMatchObject({ tickets: 2, categoryRight: 1, priorityRight: 1 });
    expect(result.days[2]?.frozen).toMatchObject({ tickets: 1, categoryRight: 1 });
    expect(result.days[1]?.retrained.tickets).toBe(0);
  });

  it('counts a High ticket that leaves unchecked as Medium against the hard line', () => {
    const rows = [row('a', 1, 'Shipping/Order Issue', 'High')];
    const low = [sure('a', 'Shipping/Order Issue', 'Medium')];
    const result = runWeek(rows, table(low), table(low), table(low));
    expect(result.days[0]?.retrained).toMatchObject({ toPerson: 0, highUrgentOutLow: 1, silentPriority: 1, silentCategory: 0 });
  });

  it('refuses a row whose day is outside the week, and a repeated id', () => {
    const answers = [sure('a', 'Shipping/Order Issue', 'Medium')];
    expect(() => runWeek([row('a', 8)], table(answers), table(answers), table(answers))).toThrow('E_WEEK_DAY');
    expect(() => runWeek([row('a', 1), row('a', 2)], table(answers), table(answers), table(answers))).toThrow('E_WEEK_ID');
  });
});
