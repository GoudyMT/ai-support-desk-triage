// What the Model History page shows, as plain data: the current model against the baseline, and one table row per
// model with each number's change from the row below it. Pure: the page only draws it.

export interface Count {
  k: number;
  n: number;
}

export interface HistoryRow {
  id: string;
  name: string;
  kind: string;
  heldOutRight: number;
  handWrittenRight: Count;
  highRiskMissed: Count | null;
  sentToPerson: number | null;
  approveCardsPerRun: number | null;
}

export type Direction = 'up' | 'down' | 'same';

export interface Change {
  direction: Direction;
  text: string;
  label: string;
}

export interface Cell {
  value: string;
  change: Change | null;
}

export interface Block extends Cell {
  title: string;
  baseline: string;
}

export interface TableRow {
  id: string;
  name: string;
  kind: string;
  current: boolean;
  cells: Cell[];
}

export interface HistoryView {
  blocks: Block[];
  columns: string[];
  rows: TableRow[];
}

export const BASELINE_ID = 'baseline';
export const NOT_MEASURED = 'Not measured';

export function formatCount(count: Count | null): string {
  return count === null ? NOT_MEASURED : `${count.k} of ${count.n}`;
}

export function formatPercent(share: number | null, digits: number): string {
  return share === null ? NOT_MEASURED : `${(share * 100).toFixed(digits)}%`;
}

const PERCENT = 100;
// Sizes are shown to one decimal; a change that rounds to zero is no change.
const DECIMALS = 1;
const SCALE = 10 ** DECIMALS;

// A number a change can be read from. `basis` is the size of the set it was measured on: two numbers only
// compare when it matches.
interface Figure {
  amount: number;
  basis: number;
}

interface Column {
  title: string;
  show: (row: HistoryRow) => string;
  figure: (row: HistoryRow) => Figure | null;
  // The size of a change as it is written, and its words for a screen reader.
  size: (amount: number) => { text: string; words: string };
}

const points = (amount: number) => ({ text: `${amount} pts`, words: `${amount} points` });
const tickets = (one: string, many: string) => (amount: number) => ({
  text: String(amount),
  words: `${amount} ${amount === 1 ? one : many}`,
});

const countFigure = (count: Count | null): Figure | null => (count === null ? null : { amount: count.k, basis: count.n });
const shareFigure = (share: number | null): Figure | null => (share === null ? null : { amount: share * PERCENT, basis: 0 });

const COLUMNS: readonly Column[] = [
  {
    title: 'Right on tickets it never saw',
    show: (row) => formatPercent(row.heldOutRight, 1),
    figure: (row) => shareFigure(row.heldOutRight),
    size: points,
  },
  {
    title: 'Right on hand-written tickets',
    show: (row) => formatCount(row.handWrittenRight),
    figure: (row) => countFigure(row.handWrittenRight),
    size: tickets('ticket', 'tickets'),
  },
  {
    title: 'High-risk missed',
    show: (row) => formatCount(row.highRiskMissed),
    figure: (row) => countFigure(row.highRiskMissed),
    size: tickets('high-risk ticket', 'high-risk tickets'),
  },
  {
    title: 'Sent to a person',
    show: (row) => formatPercent(row.sentToPerson, 0),
    figure: (row) => shareFigure(row.sentToPerson),
    size: points,
  },
  {
    title: 'Cards with Approve per run',
    show: (row) => (row.approveCardsPerRun === null ? NOT_MEASURED : row.approveCardsPerRun.toFixed(DECIMALS)),
    figure: (row) => (row.approveCardsPerRun === null ? null : { amount: row.approveCardsPerRun, basis: 0 }),
    size: tickets('card', 'cards'),
  },
];

function changeOf(column: Column, now: HistoryRow, before: HistoryRow): Change | null {
  const a = column.figure(now);
  const b = column.figure(before);
  if (a === null || b === null || a.basis !== b.basis) {
    return null;
  }
  const moved = Math.round((a.amount - b.amount) * SCALE) / SCALE;
  const direction: Direction = moved > 0 ? 'up' : moved < 0 ? 'down' : 'same';
  const { text, words } = column.size(Math.abs(moved));
  return { direction, text, label: direction === 'same' ? 'no change' : `${direction} ${words}` };
}

export function historyView(rows: readonly HistoryRow[]): HistoryView {
  const current = rows[0];
  if (current === undefined) {
    throw new Error('E_NO_HISTORY');
  }
  const baseline = rows.find((row) => row.id === BASELINE_ID);
  if (baseline === undefined) {
    throw new Error('E_NO_BASELINE');
  }
  const atBaseline = current === baseline;
  return {
    columns: COLUMNS.map((column) => column.title),
    blocks: COLUMNS.map((column) => ({
      title: column.title,
      value: column.show(current),
      baseline: `Baseline ${column.show(baseline)}${atBaseline ? '. No change yet' : ''}`,
      change: atBaseline ? null : changeOf(column, current, baseline),
    })),
    rows: rows.map((row, at) => {
      const below = rows[at + 1];
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        current: at === 0,
        cells: COLUMNS.map((column) => ({
          value: column.show(row),
          change: below === undefined ? null : changeOf(column, row, below),
        })),
      };
    }),
  };
}
