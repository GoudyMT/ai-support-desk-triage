import { describe, expect, it } from 'vitest';
import type { Predict } from '../src/pipeline/run';
import type { TicketTrail } from '../src/pipeline/types';
import { countSplit, lineBreaches, measureSplit, parseRiskRows, type RiskRow, type SplitCounts } from './measureSplit';

// The measurement behind the three-path desk: what reaches the operator, what reaches a team marked or unmarked,
// and every safety line beside the v1.1 desk's on the same tickets.

const QUIET = 'Hello, the settings page shows the wrong time zone.';
const ANGRY = 'This is unacceptable, my order never arrived';

function says(category: string, priority: string, confidence: number): Predict {
  return (head) => {
    const label = head === 'category' ? category : priority;
    return { label, confidence, probabilities: { [label]: confidence }, topTerms: [] };
  };
}

const row = (id: string, text: string, label: RiskRow['label'], reviewReason: RiskRow['reviewReason'] = null): RiskRow => ({ id, text, label, reviewReason });

describe('measureSplit', () => {
  // The hard line counts marked tickets too: a marked ticket reaches its team with no operator check.
  it('does not count a marked ticket the mark raised to High as High/Urgent sent out low', () => {
    const urgent = row('T-1', QUIET, { category: 'Security Concern', priority: 'Urgent', mustReview: true }, 'security incident');
    const c = measureSplit([urgent], says('Security Concern', 'Medium', 0.9), () => ({ category: 'Security Concern', priority: 'Medium' }));
    expect(c.split).toMatchObject({ cards: 0, marked: 1, markedRisky: 1, highOutLow: 0, riskyMissed: 0, markedWrongPriority: 1 });
    expect(c.today).toMatchObject({ cards: 1, riskyMissed: 0, highOutLow: 0 });
  });

  // If the mark ever stops raising the priority, the hard line must still see the marked ticket.
  it('counts a marked ticket left below High as High/Urgent sent out low', () => {
    const urgent = row('T-8', QUIET, { category: 'Security Concern', priority: 'Urgent', mustReview: true }, 'security incident');
    const lines = measureSplit([], says('Other', 'Low', 1), () => ({ category: 'Other', priority: 'Low' })).split;
    const trail = { path: 'marked', final: { category: 'Security Concern', priority: 'Medium', route: '', by: 'model' } } as unknown as TicketTrail;
    countSplit(lines, urgent, trail);
    expect(lines).toMatchObject({ marked: 1, highOutLow: 1 });
  });

  it('counts a marked ticket at a wrong team and a false mark, and a risky ticket sent direct as missed', () => {
    const angry = row('T-2', ANGRY, { category: 'Shipping/Order Issue', priority: 'High', mustReview: true }, 'escalated complaint');
    const wrong = measureSplit([angry], says('Billing', 'High', 0.9), () => ({ category: 'Billing', priority: 'High' }));
    expect(wrong.split).toMatchObject({ marked: 1, markedWrongTeam: 1, markedWrongTeamRisky: 1, falseMarks: 0 });
    const calm = row('T-3', QUIET, { category: 'Technical Issue', priority: 'Low', mustReview: false });
    const unsure = measureSplit([calm], says('Technical Issue', 'Low', 0.3), () => ({ category: 'Technical Issue', priority: 'Low' }));
    expect(unsure.split).toMatchObject({ marked: 1, falseMarks: 1, markedWrongPriority: 1 });
    const missed = row('T-4', QUIET, { category: 'Technical Issue', priority: 'Low', mustReview: true }, 'billing dispute');
    const direct = measureSplit([missed], says('Technical Issue', 'Low', 0.9), () => ({ category: 'Technical Issue', priority: 'Low' }));
    expect(direct.split).toMatchObject({ cards: 0, marked: 0, riskyMissed: 1 });
    expect(direct.today.riskyMissed).toBe(1);
  });

  it('counts a vague ticket that reaches a team with no person, and not as risky', () => {
    const vague = row('T-5', QUIET, { category: 'Other', priority: 'Medium', mustReview: true }, 'vague ticket');
    const c = measureSplit([vague], says('Other', 'Medium', 0.9), () => ({ category: 'Other', priority: 'Medium' }));
    expect(c.split).toMatchObject({ vagueDirect: 1, riskyMissed: 0 });
    expect(c.today).toMatchObject({ vagueDirect: 1, riskyMissed: 0 });
  });

  it('counts a disagreement as an operator card on both desks', () => {
    const calm = row('T-6', QUIET, { category: 'Technical Issue', priority: 'Low', mustReview: false });
    const c = measureSplit([calm], says('Technical Issue', 'Low', 0.9), () => ({ category: 'Billing', priority: 'Low' }));
    expect(c.split.cards).toBe(1);
    expect(c.today.cards).toBe(1);
  });
});

describe('lineBreaches', () => {
  const even: SplitCounts = {
    tickets: 10,
    today: { cards: 9, riskyMissed: 1, highOutLow: 1, uncheckedWrongDept: 1, uncheckedWrongPriority: 1, vagueDirect: 0 },
    split: { cards: 5, riskyMissed: 1, highOutLow: 1, uncheckedWrongDept: 1, uncheckedWrongPriority: 1, vagueDirect: 0, marked: 3, markedRisky: 1, falseMarks: 2, markedWrongTeam: 1, markedWrongTeamRisky: 0, markedWrongPriority: 1 },
  };

  // CI holds the desk to the v1.1 desk's safety lines, not only to the record: a re-recorded worse desk fails.
  it('names each safety line the three-path desk is worse on, and none when it is equal', () => {
    expect(lineBreaches(even)).toEqual([]);
    for (const line of ['riskyMissed', 'highOutLow', 'uncheckedWrongDept', 'uncheckedWrongPriority'] as const) {
      expect(lineBreaches({ ...even, split: { ...even.split, [line]: even.split[line] + 1 } })).toEqual([line]);
    }
  });
});

describe('parseRiskRows', () => {
  it('keeps each ticket review reason and refuses one the labels do not know', () => {
    const line = (reason: string | null) => JSON.stringify({ id: 'T-7', text: QUIET, category: 'Billing', priority: 'High', mustReview: reason !== null, reviewReason: reason });
    expect(parseRiskRows(line('billing dispute'))[0]?.reviewReason).toBe('billing dispute');
    expect(parseRiskRows(line(null))[0]?.reviewReason).toBeNull();
    expect(() => parseRiskRows(line('angry'))).toThrow('E_BAD_ROW');
  });
});
