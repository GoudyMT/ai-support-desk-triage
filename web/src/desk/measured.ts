// The numbers the desk shows before Start, read from the model history's current (newest) row, so the desk and the
// Model History page share one source. CI holds that row equal to its own measurement (scripts/measurePipeline.ts).
// The fresh hand-written set is 60 tickets written blind to the rules and the model, 24 of them must-review; the frozen
// hand-written set is 48 tickets, and the old keyword method is the history's prototype row.
import history from '../history/history.json';
import { formatCount, formatPercent, type HistoryRow } from '../history/view';

const ROWS: readonly HistoryRow[] = history;
const CURRENT = ROWS[0];
const KEYWORDS = ROWS.find((row) => row.id === 'prototype');
if (CURRENT === undefined || KEYWORDS === undefined) {
  throw new Error('E_NO_HISTORY');
}

export const HIGH_RISK_MISSED = formatCount(CURRENT.highRiskMissed);
export const SENT_TO_PERSON = formatPercent(CURRENT.sentToPerson, 0);
export const HAND_WRITTEN_RIGHT = formatCount(CURRENT.handWrittenRight);
export const KEYWORD_RIGHT = KEYWORDS.handWrittenRight.k;
