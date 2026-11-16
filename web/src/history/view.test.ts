import { describe, expect, it } from 'vitest';
import { formatPercent, historyView, type HistoryRow } from './view';

// A share stored to four places, such as 1,391 of 2,000, ends in an exact half when shown to one: it rounds up, as the
// guide and model card print it, not down as the computer's nearest binary number would.
describe('formatPercent', () => {
  it('rounds an exact half up', () => {
    expect(formatPercent(0.6955, 1)).toBe('69.6%');
    expect(formatPercent(0.9215, 1)).toBe('92.2%');
  });

  it('keeps a share below the half where it is', () => {
    expect(formatPercent(0.6954, 1)).toBe('69.5%');
  });
});

const BASELINE: HistoryRow = {
  id: 'baseline',
  name: 'Baseline model (current)',
  kind: 'Word weights plus safety rules',
  heldOutRight: 0.573,
  handWrittenRight: { k: 39, n: 48 },
  highRiskMissed: { k: 0, n: 24 },
  sentToPerson: 0.78,
  approveCardsPerRun: 50,
  blindRight: 0.695,
};
const PROTOTYPE: HistoryRow = {
  id: 'prototype',
  name: 'Course prototype',
  kind: 'Keyword rules',
  heldOutRight: 0.336,
  handWrittenRight: { k: 14, n: 48 },
  highRiskMissed: null,
  sentToPerson: null,
  approveCardsPerRun: null,
  blindRight: null,
};
const NEWER: HistoryRow = {
  id: 'newer',
  name: 'Next model',
  kind: 'Word weights plus safety rules',
  heldOutRight: 0.55,
  handWrittenRight: { k: 40, n: 48 },
  highRiskMissed: { k: 0, n: 24 },
  sentToPerson: 0.7,
  approveCardsPerRun: 60,
  blindRight: 0.9,
};
// A model measured on the blind set but not on the held-out folds or the desk runs, as the sentence model is.
const PARTLY: HistoryRow = { ...NEWER, id: 'partly', heldOutRight: null, approveCardsPerRun: null };

const cell = (rows: HistoryRow[], row: number, column: number) => historyView(rows).rows[row]?.cells[column];

describe('the change shown for each number', () => {
  // The owner wants the first row to read as an improvement: 57.3% against 33.6%, 39 against 14.
  it('shows an up arrow with its size when a number is higher than the row below', () => {
    expect(cell([BASELINE, PROTOTYPE], 0, 0)?.change).toEqual({ direction: 'up', tone: 'better', text: '23.7 pts better', label: 'up 23.7 points, better' });
    expect(cell([BASELINE, PROTOTYPE], 0, 1)?.change).toEqual({ direction: 'up', tone: 'better', text: '25 better', label: 'up 25 tickets, better' });
  });

  // The owner: a green down arrow on a number that got worse is misleading. Each column knows which way is better.
  it('calls a change better or worse by the way that number should move, not by the arrow', () => {
    const rows = [{ ...NEWER, highRiskMissed: { k: 1, n: 24 } }, BASELINE];
    expect(cell(rows, 0, 2)?.change?.tone).toBe('worse');
    expect(cell(rows, 0, 3)?.change?.tone).toBe('better');
    expect(cell([BASELINE, NEWER], 0, 3)?.change).toMatchObject({ direction: 'up', tone: 'worse', text: '8 pts worse' });
    expect(cell([BASELINE, NEWER], 0, 4)?.change).toMatchObject({ direction: 'down', tone: 'worse', label: 'down 10 cards, worse' });
  });

  // A later model that is surer lights more cards, and that change is what the column exists to show.
  it('shows the change in cards with Approve, and none against a model that never measured it', () => {
    expect(cell([NEWER, BASELINE], 0, 4)).toEqual({
      value: '60.0',
      change: { direction: 'up', tone: 'better', text: '10 better', label: 'up 10 cards, better' },
    });
    expect(cell([BASELINE, PROTOTYPE], 1, 4)).toEqual({ value: 'Not measured', change: null });
    expect(cell([BASELINE, PROTOTYPE], 0, 4)?.change).toBeNull();
  });

  it('shows a down arrow when a number is lower than the row below', () => {
    const rows = [NEWER, BASELINE];
    expect(cell(rows, 0, 0)?.change).toEqual({ direction: 'down', tone: 'worse', text: '2.3 pts worse', label: 'down 2.3 points, worse' });
    expect(cell(rows, 0, 3)?.change).toEqual({ direction: 'down', tone: 'better', text: '8 pts better', label: 'down 8 points, better' });
  });

  it('shows a flat mark with zero when a number has not moved, and says ticket in the singular', () => {
    const rows = [{ ...NEWER, highRiskMissed: { k: 1, n: 24 } }, NEWER, BASELINE];
    expect(cell(rows, 1, 2)?.change).toEqual({ direction: 'same', tone: 'same', text: '0', label: 'no change' });
    expect(cell(rows, 0, 2)?.change).toEqual({ direction: 'up', tone: 'worse', text: '1 worse', label: 'up 1 high-risk ticket, worse' });
  });

  // A change against a number nobody measured would be made up.
  it('shows no change for the last row, or when either side was not measured', () => {
    const view = historyView([BASELINE, PROTOTYPE]);
    expect(view.rows[1]?.cells.map((c) => c.change)).toEqual([null, null, null, null, null, null]);
    expect(view.rows[0]?.cells[2]?.change).toBeNull();
    expect(view.rows[0]?.cells[3]?.change).toBeNull();
    const unmeasuredAbove = [{ ...NEWER, sentToPerson: null }, BASELINE];
    expect(cell(unmeasuredAbove, 0, 3)?.change).toBeNull();
  });

  // Counts out of different test sets cannot be told apart by their top number.
  it('shows no change between counts of different sizes', () => {
    const rows = [{ ...NEWER, handWrittenRight: { k: 50, n: 60 } }, BASELINE];
    expect(cell(rows, 0, 1)?.change).toBeNull();
  });
});

describe('the table', () => {
  it('lists the newest model first with its numbers as words, and marks only the first as current', () => {
    const view = historyView([BASELINE, PROTOTYPE]);
    expect(view.rows.map((row) => [row.name, row.kind, row.current])).toEqual([
      ['Baseline model (current)', 'Word weights plus safety rules', true],
      ['Course prototype', 'Keyword rules', false],
    ]);
    expect(view.rows[0]?.cells.map((c) => c.value)).toEqual(['57.3%', '39 of 48', '0 of 24', '78%', '50.0', '69.5%']);
    expect(view.rows[1]?.cells.map((c) => c.value)).toEqual(['33.6%', '14 of 48', 'Not measured', 'Not measured', 'Not measured', 'Not measured']);
  });

  // Adding a row is how a model change reaches the page: the new row is compared with the baseline row under it.
  it('shows the change of a row added on top from the row below it, and leaves the other rows alone', () => {
    const view = historyView([NEWER, BASELINE, PROTOTYPE]);
    expect(view.rows.map((row) => row.id)).toEqual(['newer', 'baseline', 'prototype']);
    expect(view.rows[0]?.cells.map((c) => c.change?.direction)).toEqual(['down', 'up', 'same', 'down', 'up', 'up']);
    expect(view.rows[0]?.current).toBe(true);
    expect(view.rows[1]?.current).toBe(false);
    expect(view.rows[1]?.cells[0]?.change?.text).toBe('23.7 pts better');
  });
});

describe('the current model against the baseline', () => {
  it('says there is no change yet while the baseline is the current model', () => {
    const view = historyView([BASELINE, PROTOTYPE]);
    expect(view.blocks.map((b) => [b.title, b.value, b.baseline, b.change])).toEqual([
      ['Right on tickets it never saw', '57.3%', 'Baseline 57.3%. No change yet', null],
      ['Right on tickets written for this project', '39 of 48', 'Baseline 39 of 48. No change yet', null],
      ['High-risk missed', '0 of 24', 'Baseline 0 of 24. No change yet', null],
      ['Checked by the operator', '78%', 'Baseline 78%. No change yet', null],
      ['Cards with Approve per run', '50.0', 'Baseline 50.0. No change yet', null],
      ['Right on the blind set', '69.5%', 'Baseline 69.5%. No change yet', null],
    ]);
  });

  // A headline box reading "Not measured" for the current model says nothing; the table row still shows the gap.
  it('leaves out a box the current model was not measured on, and keeps its cell in the table', () => {
    const view = historyView([PARTLY, BASELINE, PROTOTYPE]);
    expect(view.blocks.map((b) => b.title)).toEqual([
      'Right on tickets written for this project',
      'High-risk missed',
      'Checked by the operator',
      'Right on the blind set',
    ]);
    expect(view.blocks[3]).toMatchObject({ value: '90.0%', baseline: 'Baseline 69.5%' });
    expect(view.blocks[3]?.change).toEqual({ direction: 'up', tone: 'better', text: '20.5 pts better', label: 'up 20.5 points, better' });
    expect(view.rows[0]?.cells[0]).toEqual({ value: 'Not measured', change: null });
  });

  // The block compares with the baseline itself, not with whichever row happens to sit below the current one.
  it('compares a newer model with the baseline row, not the row below it', () => {
    const middle: HistoryRow = { ...NEWER, id: 'middle', heldOutRight: 0.6 };
    const view = historyView([NEWER, middle, BASELINE, PROTOTYPE]);
    expect(view.blocks[0]?.value).toBe('55.0%');
    expect(view.blocks[0]?.baseline).toBe('Baseline 57.3%');
    expect(view.blocks[0]?.change).toEqual({ direction: 'down', tone: 'worse', text: '2.3 pts worse', label: 'down 2.3 points, worse' });
    expect(view.blocks[1]?.change).toEqual({ direction: 'up', tone: 'better', text: '1 better', label: 'up 1 ticket, better' });
  });

  it('refuses a history with no rows or no baseline row', () => {
    expect(() => historyView([])).toThrow('E_NO_HISTORY');
    expect(() => historyView([NEWER, PROTOTYPE])).toThrow('E_NO_BASELINE');
  });
});
