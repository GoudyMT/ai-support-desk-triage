import { describe, expect, it } from 'vitest';
import { ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import type { RunState } from './engine';
import { liveNumbers } from './liveNumbers';

interface Row {
  id: string;
  truth: [Category, Priority, boolean];
  model: [Category, number];
  modelPriority: Priority;
  reasons: FlagReason[];
  cleared?: boolean;
  guardPriority: Priority;
  // The reviewer's category and priority when the ticket was flagged; absent when the model finished it.
  reviewed?: [Category, Priority];
  v0: [Category, Priority, boolean];
}

const LOW = (confidence: number): FlagReason => ({ kind: 'low confidence', confidence });
const RULE = (reason: Extract<FlagReason, { kind: 'rule' }>['reason']): FlagReason => ({
  kind: 'rule',
  reason,
  words: [],
});
const CATEGORY = (category: Category): FlagReason => ({ kind: 'category', category });

// Twelve tickets T01..T12 whose time taken is 10 ms times the number in the id (780 ms in all).
// Rows follow what the guard can produce (floor 0.5). T07's reviewer changed only the priority.
const ROWS: Row[] = [
  { id: 'T01', truth: ['Product Question', 'Medium', false], model: ['Product Question', 0.9], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Other', 'Medium', false] },
  { id: 'T02', truth: ['Billing', 'Medium', false], model: ['Billing', 0.8], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Billing', 'Medium', true] },
  { id: 'T03', truth: ['Technical Issue', 'High', false], model: ['Technical Issue', 0.7], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Technical Issue', 'High', false] },
  { id: 'T04', truth: ['Shipping/Order Issue', 'Medium', false], model: ['Account Access', 0.85], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Other', 'Medium', false] },
  { id: 'T05', truth: ['Security Concern', 'Urgent', true], model: ['Security Concern', 0.95], modelPriority: 'Urgent', reasons: [RULE('security incident'), CATEGORY('Security Concern')], guardPriority: 'Urgent', reviewed: ['Security Concern', 'Urgent'], v0: ['Security Concern', 'Urgent', true] },
  { id: 'T06', truth: ['Accessibility Support', 'High', true], model: ['Technical Issue', 0.6], modelPriority: 'Medium', reasons: [RULE('accessibility issue')], guardPriority: 'High', reviewed: ['Accessibility Support', 'High'], v0: ['Accessibility Support', 'High', true] },
  { id: 'T07', truth: ['Billing', 'Medium', true], model: ['Billing', 0.9], modelPriority: 'Low', reasons: [RULE('billing dispute')], guardPriority: 'Medium', reviewed: ['Billing', 'High'], v0: ['Billing', 'Medium', true] },
  { id: 'T08', truth: ['Urgent Complaint', 'High', true], model: ['Product Question', 0.55], modelPriority: 'Low', reasons: [], guardPriority: 'Low', v0: ['Other', 'Medium', false] },
  { id: 'T09', truth: ['Other', 'Medium', true], model: ['Product Question', 0.3], modelPriority: 'Medium', reasons: [RULE('vague ticket'), LOW(0.3)], guardPriority: 'Medium', reviewed: ['Other', 'Medium'], v0: ['Other', 'Medium', false] },
  { id: 'T10', truth: ['Other', 'Low', true], model: ['Product Question', 0.3], modelPriority: 'Low', reasons: [LOW(0.3)], cleared: true, guardPriority: 'Low', v0: ['Other', 'Medium', false] },
  { id: 'T11', truth: ['Account Access', 'High', false], model: ['Technical Issue', 0.45], modelPriority: 'Medium', reasons: [LOW(0.45)], guardPriority: 'Medium', reviewed: ['Account Access', 'High'], v0: ['Account Access', 'High', false] },
  { id: 'T12', truth: ['Urgent Complaint', 'High', true], model: ['Urgent Complaint', 0.75], modelPriority: 'High', reasons: [RULE('threatening language'), RULE('escalated complaint'), CATEGORY('Urgent Complaint')], guardPriority: 'Urgent', reviewed: ['Technical Issue', 'High'], v0: ['Other', 'Medium', false] },
];

function trailOf(row: Row, ms = 10 * Number(row.id.slice(1))): TicketTrail {
  const [modelCategory, confidence] = row.model;
  const flagged = row.reasons.length > 0 && row.cleared !== true;
  const base = {
    id: row.id,
    receivedAt: 0,
    maskedText: '',
    found: [],
    category: {
      label: modelCategory,
      confidence,
      probabilities: { [modelCategory]: confidence },
      topTerms: [{ term: `word-${row.id}`, weight: confidence }],
    },
    priority: { label: row.modelPriority, confidence: 1, probabilities: {}, topTerms: [] },
    guard: {
      flagged,
      reasons: row.reasons,
      priority: row.guardPriority,
      clearedBySecondCheck: row.cleared === true,
    },
    v0: { category: row.v0[0], priority: row.v0[1], mustReview: row.v0[2] },
    ms,
  };
  if (row.reviewed === undefined) {
    return {
      ...base,
      final: { category: modelCategory, priority: row.guardPriority, route: ROUTES[modelCategory], by: 'model' },
    };
  }
  const [category, priority] = row.reviewed;
  const decision = { category, priority, route: ROUTES[category] };
  return { ...base, review: decision, final: { ...decision, by: 'reviewer' } };
}

const TRAILS = ROWS.map((row) => trailOf(row));
const TRUTH = new Map<string, TicketLabel>(
  ROWS.map((row) => [row.id, { category: row.truth[0], priority: row.truth[1], mustReview: row.truth[2] }]),
);
const truthOf = (id: string): TicketLabel => {
  const label = TRUTH.get(id);
  if (label === undefined) throw new Error('E_TEST_FIXTURE');
  return label;
};

function trail(id: string, ms?: number): TicketTrail {
  const row = ROWS.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error('E_TEST_FIXTURE');
  return trailOf(row, ms);
}

function stateOf(parts: {
  done: TicketTrail[];
  realSpeed?: NonNullable<RunState['realSpeed']>;
  current?: NonNullable<RunState['current']>;
  open?: TicketTrail[];
  reviewing?: TicketTrail;
  viewerReviews?: RunState['viewerReviews'];
}): RunState {
  const state: RunState = {
    seed: 1001,
    fold: 1,
    act: 1,
    playing: true,
    simTime: 0,
    incoming: [],
    open: parts.open ?? [],
    done: parts.done,
    viewerReviews: parts.viewerReviews ?? [],
  };
  if (parts.current !== undefined) state.current = parts.current;
  if (parts.reviewing !== undefined) state.reviewing = parts.reviewing;
  if (parts.realSpeed !== undefined) state.realSpeed = parts.realSpeed;
  return state;
}

describe('liveNumbers on the twelve-ticket fixture', () => {
  // Guards the page's numbers panel at the end of a run: it must agree with the end report.
  it('equals the hand count when all twelve tickets are done', () => {
    const state = stateOf({
      done: TRAILS,
      realSpeed: { tickets: 12, ms: 780 },
      viewerReviews: [
        { id: 'T05', correct: true },
        { id: 'T06', correct: false },
        { id: 'T09', correct: true },
      ],
    });
    const numbers = liveNumbers(state, truthOf);
    expect(numbers.done).toBe(12);
    // Model category right on T01 T02 T03 T05 T07 T12 = 6 of 12.
    expect(numbers.modelAccuracy).toBeCloseTo(6 / 12, 10);
    // v0 category right on T02 T03 T05 T06 T07 T09 T10 T11 = 8 of 12.
    expect(numbers.v0Accuracy).toBeCloseTo(8 / 12, 10);
    // Flagged: T05 T06 T07 T09 T11 T12 = 6 of 12 (T10 was cleared by the second check).
    expect(numbers.flaggedShare).toBeCloseTo(6 / 12, 10);
    // Must-review truth left unflagged: T08 and T10.
    expect(numbers.highRiskMissed).toBe(2);
    // Reviewed: T05 T06 T07 T09 T11 T12; the reviewer changed the model's category on T06 T09 T11 T12
    // = 4. T07's priority-only change is not counted: the live number must equal the count behind the
    // end report's override rate (4 of 6 reviewed), or the panel and the report disagree.
    expect(numbers.overrides).toBe(4);
    expect(numbers.viewerCorrect).toEqual({ correct: 2, total: 3 });
    // The real speed run measured 12 tickets in 780 ms.
    expect(numbers.perSecond).toBeCloseTo(12 / 0.78, 10);
  });

  // Guards the "High-risk missed so far" figure: a flagged ticket still in the center, open or in
  // the review form is not missed, and must not inflate the done count or the flag share.
  it('counts only closed tickets, not the center, the open list or the review form', () => {
    const state = stateOf({
      done: ['T01', 'T02', 'T03', 'T04'].map((id) => trail(id)),
      current: { trail: trail('T05'), stage: 'guardrails' },
      open: [trail('T06'), trail('T09')],
      reviewing: trail('T12'),
    });
    const numbers = liveNumbers(state, truthOf);
    expect(numbers.done).toBe(4);
    expect(numbers.highRiskMissed).toBe(0);
    expect(numbers.flaggedShare).toBe(0);
    expect(numbers.overrides).toBe(0);
    expect(numbers.modelAccuracy).toBeCloseTo(3 / 4, 10);
  });

  // Guards the first moments of a run, before any ticket is done: no division by zero, no NaN on screen.
  it('gives zeros and nulls before any ticket is done', () => {
    const current = { trail: trail('T01'), stage: 'intake' as const };
    const numbers = liveNumbers(stateOf({ done: [], realSpeed: { tickets: 12, ms: 780 }, current }), truthOf);
    expect(numbers).toEqual({
      done: 0,
      perSecond: null,
      modelAccuracy: null,
      v0Accuracy: null,
      flaggedShare: null,
      overrides: 0,
      highRiskMissed: 0,
      viewerCorrect: { correct: 0, total: 0 },
    });
  });
});

describe('liveNumbers perSecond', () => {
  const two = ['T01', 'T02'].map((id) => trail(id));

  // Guards the paced run: its tickets carry measured times, but the page waits between them, so
  // a rate from those times would mislead. Only the real speed run is a rate.
  it('is null until a real speed run has been measured', () => {
    expect(liveNumbers(stateOf({ done: two }), truthOf).perSecond).toBeNull();
  });

  it('is the real speed run\'s tickets over its measured seconds', () => {
    // 130 tickets in 50 ms, whatever the per-ticket times add up to.
    expect(liveNumbers(stateOf({ done: two, realSpeed: { tickets: 130, ms: 50 } }), truthOf).perSecond).toBeCloseTo(2600, 10);
  });

  // Guards a coarse browser timer that measures the whole run as 0 ms: no Infinity on screen.
  it('is null when the measured time is zero', () => {
    expect(liveNumbers(stateOf({ done: two, realSpeed: { tickets: 130, ms: 0 } }), truthOf).perSecond).toBeNull();
  });
});
