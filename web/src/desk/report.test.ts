import { describe, expect, it } from 'vitest';
import type { TicketLabel } from '../domain/labels';
import { computeMetrics } from '../pipeline/metrics';
import type { RunState } from '../run/engine';
import { makeDeskRun, stepToEnd, stepUntil } from '../run/engineTestKit';
import { HOURLY_PAY_USD, MINUTES_PER_TICKET, dollarsText, minutesText, valueSaved } from '../run/valueSaved';
import { reportView } from './report';

const TOTAL = 130;
const ASSUMED = { minutes: MINUTES_PER_TICKET, pay: HOURLY_PAY_USD };
const percent = (share: number): string => `${Math.round(share * 100)}%`;

interface Held {
  state: RunState;
  truthOf: (id: string) => TicketLabel;
}

function held(until: (state: RunState) => boolean): Held {
  const run = makeDeskRun();
  stepUntil(run, until);
  return { state: run.state(), truthOf: (id) => run.truthOf(id) };
}

function finished(): Held {
  const run = makeDeskRun();
  stepToEnd(run);
  return { state: run.state(), truthOf: (id) => run.truthOf(id) };
}

// What the report must print for these closed tickets, worked out here from computeMetrics and the demo's value saved.
function expected({ state, truthOf }: Held): { table: string[]; rows: string[] } {
  const m = computeMetrics(state.done, truthOf);
  const saved = valueSaved(state, truthOf);
  const flagged = state.done.filter((trail) => trail.guard.flagged).length;
  return {
    table: [
      percent(m.v0.category),
      percent(m.categoryAccuracy.model),
      percent(m.categoryAccuracy.system),
      percent(m.v0.priority),
      percent(m.priorityAccuracy.model),
      percent(m.priorityAccuracy.system),
    ],
    rows: [
      `${flagged} (${percent(m.flagRate)})`,
      percent(m.overrideRate),
      String(m.handledWithoutReview),
      `${m.msPerTicket.toFixed(1)} ms`,
      minutesText(saved.minutes),
      dollarsText(saved.dollars),
    ],
  };
}

describe('reportView on a finished run', () => {
  it('prints every figure as computeMetrics works it out for the 130 closed tickets', () => {
    const run = finished();
    const view = reportView(run.state, run.truthOf, TOTAL, ASSUMED);
    const want = expected(run);
    expect(view.heading).toBe('After action report: 130 tickets');
    // Model alone and After review differ here, so a column read from the wrong field shows.
    expect(computeMetrics(run.state.done, run.truthOf).categoryAccuracy.model).not.toBe(
      computeMetrics(run.state.done, run.truthOf).categoryAccuracy.system,
    );
    expect(view.table).toEqual(want.table);
    expect(view.rows.slice(0, 6)).toEqual(want.rows);
    expect(view.rows).toHaveLength(7);
  });

  it('turns the two assumptions into the estimate rows', () => {
    const run = finished();
    const counted = valueSaved(run.state, run.truthOf).counted;
    const view = reportView(run.state, run.truthOf, TOTAL, { minutes: 3, pay: 30 });
    expect(view.rows[4]).toBe(minutesText(counted * 3));
    expect(view.rows[5]).toBe(dollarsText(((counted * 3) / 60) * 30));
  });
});

describe('reportView in the middle of a run', () => {
  it('covers the one ticket that has closed, says so far, and does not throw', () => {
    const run = held((s) => s.done.length >= 1);
    expect(run.state.done).toHaveLength(1);
    const view = reportView(run.state, run.truthOf, TOTAL, ASSUMED);
    expect(view.heading).toBe('After action report so far: 1 of 130 tickets');
    expect(view.table).toEqual(expected(run).table);
    expect(view.rows.slice(0, 6)).toEqual(expected(run).rows);
  });

  it('covers only the closed tickets, never the ones still waiting', () => {
    const run = held((s) => s.done.length >= 41 && s.open.length > 0);
    const view = reportView(run.state, run.truthOf, TOTAL, ASSUMED);
    expect(view.heading).toBe(`After action report so far: ${run.state.done.length} of 130 tickets`);
    expect(view.table).toEqual(expected(run).table);
    expect(view.rows.slice(0, 6)).toEqual(expected(run).rows);
  });
});

describe('wrong quick approvals', () => {
  it('counts a quick approval that was wrong, out of the quick approvals, and leaves a wrong review that was not quick', () => {
    const run = finished();
    const [a, b, c] = run.state.done;
    if (a === undefined || b === undefined || c === undefined) throw new Error('test: too few tickets');
    const state: RunState = {
      ...run.state,
      viewerReviews: [
        { id: a.id, correct: true, quick: true },
        { id: b.id, correct: false, quick: true },
        { id: c.id, correct: false, quick: false },
      ],
    };
    expect(reportView(state, run.truthOf, TOTAL, ASSUMED).rows[6]).toBe('1 of 2');
  });

  it('reads 0 of 0 when the viewer approved nothing', () => {
    const run = finished();
    expect(run.state.viewerReviews).toEqual([]);
    expect(reportView(run.state, run.truthOf, TOTAL, ASSUMED).rows[6]).toBe('0 of 0');
  });
});

describe('the lead sentence', () => {
  // The same closed tickets, with exactly `count` of the ones no person looked at said to be high-risk.
  function withMissed(count: number): { lead: string; flagged: number; closed: number; right: string } {
    const run = finished();
    const unflagged = run.state.done.filter((trail) => !trail.guard.flagged).map((trail) => trail.id);
    expect(unflagged.length).toBeGreaterThanOrEqual(count);
    const risky = new Set(unflagged.slice(0, count));
    const truthOf = (id: string): TicketLabel => ({ ...run.truthOf(id), mustReview: risky.has(id) });
    const m = computeMetrics(run.state.done, truthOf);
    expect(m.highRiskMissed).toBe(count);
    return {
      lead: reportView(run.state, truthOf, TOTAL, ASSUMED).lead,
      flagged: run.state.done.filter((trail) => trail.guard.flagged).length,
      closed: run.state.done.length,
      right: percent(m.categoryAccuracy.model),
    };
  }

  const second = (w: { flagged: number; closed: number; right: string }): string =>
    ` The model alone got the category right ${w.right} of the time, and people checked ${w.flagged} of ${w.closed} tickets.`;

  it('says no high-risk ticket got past review when none did', () => {
    const w = withMissed(0);
    expect(w.lead).toBe(`No high-risk ticket got past review.${second(w)}`);
  });

  it('says 1 high-risk ticket in the singular', () => {
    const w = withMissed(1);
    expect(w.lead).toBe(`1 high-risk ticket got past review.${second(w)}`);
  });

  it('says 2 high-risk tickets in the plural', () => {
    const w = withMissed(2);
    expect(w.lead).toBe(`2 high-risk tickets got past review.${second(w)}`);
  });
});

describe('where the model went wrong', () => {
  it('shows each instructive miss with the ticket\'s masked text, what the model said and the words that misled it', () => {
    const run = finished();
    const m = computeMetrics(run.state.done, run.truthOf);
    expect(m.instructiveMisses.length).toBeGreaterThan(0);
    const view = reportView(run.state, run.truthOf, TOTAL, ASSUMED);
    expect(view.misses).toEqual(
      m.instructiveMisses.map((miss) => ({
        text: run.state.done.find((trail) => trail.id === miss.id)?.maskedText,
        detail: `Said ${miss.predicted}, truly ${miss.truth}. Words that misled it: ${miss.topTerms.map((t) => t.term).join(', ')}`,
      })),
    );
    expect(view.misses.every((miss) => (miss.text ?? '') !== '')).toBe(true);
  });

  it('says there were no misses in one line when the model was right every time', () => {
    const run = finished();
    const said = new Map(run.state.done.map((trail) => [trail.id, trail.category.label]));
    const truthOf = (id: string): TicketLabel => ({ ...run.truthOf(id), category: said.get(id) as TicketLabel['category'] });
    const view = reportView(run.state, truthOf, TOTAL, ASSUMED);
    expect(view.misses).toEqual([{ text: 'No misses in these tickets.', detail: '' }]);
  });

  it('holds nothing but the figures, words and masked tickets: no field for a viewer\'s note', () => {
    const run = finished();
    const view = reportView(run.state, run.truthOf, TOTAL, ASSUMED);
    expect(Object.keys(view).sort()).toEqual(['heading', 'lead', 'misses', 'rows', 'table']);
    for (const miss of view.misses) expect(Object.keys(miss).sort()).toEqual(['detail', 'text']);
  });
});
