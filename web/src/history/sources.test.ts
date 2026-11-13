import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HistoryRow } from './view';

// The sentence model's row, the blind-set column and the page's words about the 90-day runs are typed into the
// site's files; each is held here to the report it came from, so a number edited by hand, or a report recorded
// again, fails until the two agree. The word model's rows are held to theirs by scripts/measurePipeline.ts.

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = <T>(path: string): T => JSON.parse(read(path)) as T;

interface Counts {
  tickets: number;
  flagged: number;
  mustReview: number;
  highRiskMissed: number;
}
interface SetsReport {
  sets: Record<string, { both: Counts }>;
}
interface BlindReport {
  word: { all: { category: number } };
  models: Record<string, { all: { tickets: number; alone: { category: number } } }>;
}
interface BundleReport {
  scored: Record<string, { n: number; category_right: number }>;
}
interface NinetyReport {
  verdict: { passed: boolean; streams: { beats_own_start: boolean }[] };
}

const ROWS = json<HistoryRow[]>('./history.json');
const SETS = json<SetsReport>('../../../ml/reports/two_model_sets.json');
const BLIND = json<BlindReport>('../../../ml/reports/blind_reading.json');
const BUNDLE = json<BundleReport>('../../../ml/reports/bundle_v2.json');
const FIRST_RUN = json<NinetyReport>('../../../ml/reports/ninety_day.json');
const FAIR_RUN = json<NinetyReport>('../../../ml/reports/ninety_day_fair.json');
const HISTORY_PAGE = read('../../model-history.html').replace(/\s+/g, ' ');
const DESK_PAGE = read('../../index.html').replace(/\s+/g, ' ');

// The 60 tickets written blind and frozen, as the word model's row measures them.
const FRESH = SETS.sets['hand-written (fresh)']?.both;
const DESK = SETS.sets['desk-only wording']?.both;
const SENTENCE_BLIND = BLIND.models['sentence']?.all;
const row = (id: string): HistoryRow | undefined => ROWS.find((one) => one.id === id);
const share = (k: number, n: number, digits: number): number => Number((k / n).toFixed(digits));
const percent = (value: number): string => `${Math.round(value * 100)}%`;
const ownStart = (report: NinetyReport): number => report.verdict.streams.filter((stream) => stream.beats_own_start).length;

describe('the sentence model row', () => {
  it('is the current row, and its numbers are the recorded ones on the same sets as the word model', () => {
    const sentence = ROWS[0];
    const hand = BUNDLE.scored['handwritten'];
    if (FRESH === undefined || SENTENCE_BLIND === undefined || hand === undefined || sentence === undefined) throw new Error('E_REPORT_SHAPE');
    expect(sentence.id).toBe('sentence');
    expect(sentence.handWrittenRight).toEqual({ k: hand.category_right, n: hand.n });
    expect(sentence.highRiskMissed).toEqual({ k: FRESH.highRiskMissed, n: FRESH.mustReview });
    expect(sentence.sentToPerson).toBe(share(FRESH.flagged, FRESH.tickets, 2));
    // Four places: 2,000 tickets give shares in steps of 0.0005, so three places would round a reading away.
    expect(sentence.blindRight).toBe(share(SENTENCE_BLIND.alone.category, SENTENCE_BLIND.tickets, 4));
    // Never scored on the word model's held-out folds or its desk runs: a number from another set would be made up.
    expect(sentence.heldOutRight).toBeNull();
    expect(sentence.approveCardsPerRun).toBeNull();
  });

  it('gives the word model its blind-set reading, and the keyword prototype none', () => {
    if (SENTENCE_BLIND === undefined) throw new Error('E_REPORT_SHAPE');
    expect(row('baseline')?.blindRight).toBe(share(BLIND.word.all.category, SENTENCE_BLIND.tickets, 4));
    expect(row('prototype')?.blindRight).toBeNull();
  });
});

describe('what the pages say', () => {
  // The owner asked that the page say plainly when more tickets go to a person, not leave it to the table.
  it('says the share sent to a person went up, from the word model to the sentence model', () => {
    const before = row('baseline')?.sentToPerson;
    const after = ROWS[0]?.sentToPerson;
    if (before == null || after == null) throw new Error('E_REPORT_SHAPE');
    expect(after).toBeGreaterThan(before);
    expect(HISTORY_PAGE).toContain(`went up, from ${percent(before)} to ${percent(after)}`);
  });

  it('gives both 90-day runs as measured, the fair one named, neither passed', () => {
    expect([FIRST_RUN.verdict.passed, FAIR_RUN.verdict.passed]).toEqual([false, false]);
    expect(HISTORY_PAGE).toContain(`the first run on ${ownStart(FIRST_RUN)} of ${FIRST_RUN.verdict.streams.length} streams`);
    expect(HISTORY_PAGE).toContain(`the fair run on ${ownStart(FAIR_RUN)} of ${FAIR_RUN.verdict.streams.length}`);
  });

  // The desk's own wording is what a live run deals, under both models.
  it('gives the desk the share a live run sends to a person', () => {
    if (DESK === undefined) throw new Error('E_REPORT_SHAPE');
    expect(DESK_PAGE).toContain(`about ${percent(DESK.flagged / DESK.tickets)} of tickets go to a person`);
  });
});
