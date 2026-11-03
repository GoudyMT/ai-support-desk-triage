import { describe, expect, it } from 'vitest';
import type { TicketTrail } from '../pipeline/types';
import { createSchedule, type Schedule } from '../run/clock';
import type { RunState, Speed } from '../run/engine';
import type { Stage } from '../run/stage';
import {
  LEARN_DEEP_STAGE_MS,
  QUICK_TICKET_MS,
  REAL_STAGE_MS,
  nextDelayMs,
  ticketIndex,
} from './pacing';

const SEED = 1001;
const REAL = createSchedule(SEED);
// Moves a ticket makes from intake to the next ticket: four on the way to done, one to leave it;
// a flagged ticket makes one more, through review.
const UNFLAGGED_MOVES = 5;
const FLAGGED_MOVES = 6;

function trailOf(index: number, flagged: boolean): TicketTrail {
  return {
    id: `T-${SEED}-${index}`,
    receivedAt: 0,
    maskedText: '',
    found: [],
    category: { label: 'Billing', confidence: 0.9, probabilities: {}, topTerms: [] },
    priority: { label: 'Low', confidence: 0.9, probabilities: {}, topTerms: [] },
    guard: { flagged, reasons: [], priority: 'Low', clearedBySecondCheck: false },
    final: { category: 'Billing', priority: 'Low', route: 'Billing Team', by: 'model' },
    v0: { category: 'Billing', priority: 'Low', mustReview: false },
    ms: 0,
  };
}

function stateAt(
  index: number,
  stage: Stage,
  opts: { speed?: Speed; playing?: boolean; flagged?: boolean; waiting?: boolean } = {},
): RunState {
  return {
    seed: SEED,
    fold: 1,
    act: index < 30 ? 1 : 2,
    speed: opts.speed ?? 'learn',
    playing: opts.playing ?? true,
    takeOver: false,
    current: { trail: trailOf(index, opts.flagged ?? false), stage, waitingForViewer: opts.waiting ?? false },
    done: [],
    viewerReviews: [],
    simTime: 0,
  };
}

// Tickets 40 and 41 arrive 3 s apart and ticket 29 / 30 cross from Act 1 to Act 2 12 s apart.
const GAPPED: Schedule = {
  total: 50,
  act: (i) => (i < 30 ? 1 : 2),
  arrivesAt: (i) => (i < 30 ? i : i === 30 ? 41 : 41 + (i - 30) * 3),
};

describe('ticketIndex', () => {
  it('reads the number a run id ends with', () => {
    expect(ticketIndex('T-1001-0')).toBe(0);
    expect(ticketIndex('T-4294967295-129')).toBe(129);
  });

  it('refuses an id that does not end in a number', () => {
    expect(() => ticketIndex('T-1001-x')).toThrow('E_TICKET_ID');
  });
});

describe('when the page waits before the next advance', () => {
  it('does not run the timer while paused, waiting for the viewer, or complete', () => {
    expect(nextDelayMs(stateAt(0, 'intake', { playing: false }), REAL)).toBeNull();
    expect(nextDelayMs(stateAt(5, 'review', { waiting: true, flagged: true }), REAL)).toBeNull();
    const complete = { ...stateAt(0, 'intake') };
    delete complete.current;
    expect(nextDelayMs(complete, REAL)).toBeNull();
  });

  it('shows each stage of the first three tickets for about 5 seconds at learn speed', () => {
    expect(nextDelayMs(stateAt(0, 'intake'), REAL)).toBe(LEARN_DEEP_STAGE_MS);
    expect(nextDelayMs(stateAt(2, 'guardrails', { flagged: true }), REAL)).toBe(LEARN_DEEP_STAGE_MS);
    expect(nextDelayMs(stateAt(2, 'done'), REAL)).toBe(LEARN_DEEP_STAGE_MS);
  });

  it('spends about a second on each later learn-speed ticket, spread over its moves', () => {
    expect(nextDelayMs(stateAt(3, 'classify'), REAL)).toBe(QUICK_TICKET_MS / UNFLAGGED_MOVES);
    expect(nextDelayMs(stateAt(29, 'privacy', { flagged: true }), REAL)).toBe(QUICK_TICKET_MS / FLAGGED_MOVES);
  });

  it('uses the one-second pace when the viewer switches to real speed during Act 1', () => {
    expect(nextDelayMs(stateAt(0, 'intake', { speed: 'real' }), REAL)).toBe(QUICK_TICKET_MS / UNFLAGGED_MOVES);
    expect(nextDelayMs(stateAt(10, 'done', { speed: 'real' }), REAL)).toBe(QUICK_TICKET_MS / UNFLAGGED_MOVES);
  });

  it('moves a real-speed Act 2 ticket through its stages about 100 ms each', () => {
    expect(nextDelayMs(stateAt(40, 'privacy', { speed: 'real' }), GAPPED)).toBe(REAL_STAGE_MS);
    expect(nextDelayMs(stateAt(40, 'review', { speed: 'real', flagged: true }), GAPPED)).toBe(REAL_STAGE_MS);
  });

  it('holds a finished Act 2 ticket until the next one arrives, one simulated second per wall second', () => {
    // 3000 ms between arrivals, less the four stage moves the ticket already took.
    expect(nextDelayMs(stateAt(40, 'done', { speed: 'real' }), GAPPED)).toBe(3000 - 4 * REAL_STAGE_MS);
    // A flagged ticket took five stage moves.
    expect(nextDelayMs(stateAt(40, 'done', { speed: 'real', flagged: true }), GAPPED)).toBe(
      3000 - 5 * REAL_STAGE_MS,
    );
  });

  it('never waits less than one stage when arrivals are closer than the stage moves', () => {
    const crowded: Schedule = { ...GAPPED, arrivesAt: (i) => (i < 30 ? i : 41 + (i - 30) * 0.05) };
    expect(nextDelayMs(stateAt(40, 'done', { speed: 'real' }), crowded)).toBe(REAL_STAGE_MS);
  });

  it('waits for the first Act 2 arrival after the last Act 1 ticket at real speed', () => {
    const stage = QUICK_TICKET_MS / UNFLAGGED_MOVES;
    // 12 s from ticket 29 to ticket 30, less the four moves at the one-second pace.
    expect(nextDelayMs(stateAt(29, 'done', { speed: 'real' }), GAPPED)).toBe(12000 - 4 * stage);
  });

  it('finishes the run after the last ticket without waiting for an arrival', () => {
    expect(nextDelayMs(stateAt(129, 'done', { speed: 'real' }), REAL)).toBe(REAL_STAGE_MS);
  });
});
