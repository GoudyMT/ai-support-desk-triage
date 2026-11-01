import { describe, expect, it } from 'vitest';
import { ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { computeMetrics } from './metrics';
import type { FlagReason, TicketTrail } from './types';

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

// Twelve tickets, ids T01..T12, whose time taken is 10 ms times the number in the id.
// Every row is one the guard could produce with a confidence floor of 0.5: reasons in the
// guard's order (rules, then category, then low confidence), low confidence only below 0.5,
// and a guard priority that is the higher of the priority head and the rules' priorities.
// A reviewed row's priority is the true one, so it can differ from the guard's.
const ROWS: Row[] = [
  { id: 'T01', truth: ['Product Question', 'Medium', false], model: ['Product Question', 0.9], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Other', 'Medium', false] },
  { id: 'T02', truth: ['Billing', 'Medium', false], model: ['Billing', 0.8], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Billing', 'Medium', true] },
  { id: 'T03', truth: ['Technical Issue', 'High', false], model: ['Technical Issue', 0.7], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Technical Issue', 'High', false] },
  { id: 'T04', truth: ['Shipping/Order Issue', 'Medium', false], model: ['Account Access', 0.85], modelPriority: 'Medium', reasons: [], guardPriority: 'Medium', v0: ['Other', 'Medium', false] },
  { id: 'T05', truth: ['Security Concern', 'Urgent', true], model: ['Security Concern', 0.95], modelPriority: 'Urgent', reasons: [RULE('security incident'), CATEGORY('Security Concern')], guardPriority: 'Urgent', reviewed: ['Security Concern', 'Urgent'], v0: ['Security Concern', 'Urgent', true] },
  { id: 'T06', truth: ['Accessibility Support', 'High', true], model: ['Technical Issue', 0.6], modelPriority: 'Medium', reasons: [RULE('accessibility issue')], guardPriority: 'High', reviewed: ['Accessibility Support', 'High'], v0: ['Accessibility Support', 'High', true] },
  { id: 'T07', truth: ['Billing', 'Medium', true], model: ['Billing', 0.9], modelPriority: 'Low', reasons: [RULE('billing dispute')], guardPriority: 'Medium', reviewed: ['Billing', 'Medium'], v0: ['Billing', 'Medium', true] },
  { id: 'T08', truth: ['Urgent Complaint', 'High', true], model: ['Product Question', 0.55], modelPriority: 'Low', reasons: [], guardPriority: 'Low', v0: ['Other', 'Medium', false] },
  { id: 'T09', truth: ['Other', 'Medium', true], model: ['Product Question', 0.3], modelPriority: 'Medium', reasons: [RULE('vague ticket'), LOW(0.3)], guardPriority: 'Medium', reviewed: ['Other', 'Medium'], v0: ['Other', 'Medium', false] },
  { id: 'T10', truth: ['Other', 'Low', true], model: ['Product Question', 0.3], modelPriority: 'Low', reasons: [LOW(0.3)], cleared: true, guardPriority: 'Low', v0: ['Other', 'Medium', false] },
  { id: 'T11', truth: ['Account Access', 'High', false], model: ['Technical Issue', 0.45], modelPriority: 'Medium', reasons: [LOW(0.45)], guardPriority: 'Medium', reviewed: ['Account Access', 'High'], v0: ['Account Access', 'High', false] },
  { id: 'T12', truth: ['Urgent Complaint', 'High', true], model: ['Urgent Complaint', 0.75], modelPriority: 'High', reasons: [RULE('threatening language'), RULE('escalated complaint'), CATEGORY('Urgent Complaint')], guardPriority: 'Urgent', reviewed: ['Technical Issue', 'High'], v0: ['Other', 'Medium', false] },
];

function trailOf(row: Row): TicketTrail {
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
    ms: 10 * Number(row.id.slice(1)),
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

const TRAILS = ROWS.map(trailOf);
const TRUTH = new Map<string, TicketLabel>(
  ROWS.map((row) => [
    row.id,
    { category: row.truth[0], priority: row.truth[1], mustReview: row.truth[2] },
  ]),
);
const truthOf = (id: string): TicketLabel => {
  const label = TRUTH.get(id);
  if (label === undefined) throw new Error('E_TEST_FIXTURE');
  return label;
};

describe('computeMetrics on the twelve-ticket fixture', () => {
  const metrics = computeMetrics(TRAILS, truthOf);

  it('counts category and priority accuracy for the model alone and for the system after review', () => {
    // Model category right on T01 T02 T03 T05 T07 T12 = 6 of 12; after review also T06 T09 T11 but not T12 = 8.
    expect(metrics.categoryAccuracy.model).toBeCloseTo(6 / 12, 10);
    expect(metrics.categoryAccuracy.system).toBeCloseTo(8 / 12, 10);
    // Model priority right on T01 T02 T04 T05 T09 T10 T12 = 7 of 12; the system is wrong only where no
    // reviewer fixed it, on T03 and T08 (the guard's raised priority alone, such as T12's Urgent, is not the final one) = 10.
    expect(metrics.priorityAccuracy.model).toBeCloseTo(7 / 12, 10);
    expect(metrics.priorityAccuracy.system).toBeCloseTo(10 / 12, 10);
  });

  it('counts a must-review ticket that reached done unreviewed, including one the second check cleared', () => {
    // Must-review truth: T05 T06 T07 T08 T09 T10 T12; unflagged among them: T08, and T10 (cleared).
    expect(metrics.highRiskMissed).toBe(2);
  });

  it('counts flags, the reasons behind them and the second-check clears', () => {
    // Flagged: T05 T06 T07 T09 T11 T12 = 6 of 12 (T10 was cleared, so it is not flagged).
    expect(metrics.flagRate).toBeCloseTo(6 / 12, 10);
    expect(metrics.flagsByReason).toEqual({
      'security incident': 1,
      'accessibility issue': 1,
      'billing dispute': 1,
      'vague ticket': 1,
      'escalated complaint': 1,
      'threatening language': 1,
      category: 2,
      'low confidence': 2,
    });
    expect(metrics.secondCheckCleared).toBe(1);
    expect(metrics.handledWithoutReview).toBe(6);
  });

  it('counts how often the reviewer changed the model category among reviewed tickets', () => {
    // Reviewed: T05 T06 T07 T09 T11 T12; changed: T06 T09 T11 T12 = 4 of 6.
    expect(metrics.overrideRate).toBeCloseTo(4 / 6, 10);
  });

  it('scores v0 on the same tickets against the truth', () => {
    // Category right: T02 T03 T05 T06 T07 T09 T10 T11 = 8; priority right except T08 T10 T12 = 9;
    // review flag right on T01 T03 T04 T05 T06 T07 T11 = 7.
    expect(metrics.v0.category).toBeCloseTo(8 / 12, 10);
    expect(metrics.v0.priority).toBeCloseTo(9 / 12, 10);
    expect(metrics.v0.flag).toBeCloseTo(7 / 12, 10);
  });

  it('averages the time per ticket', () => {
    // 10 + 20 + ... + 120 = 780 over 12 tickets.
    expect(metrics.msPerTicket).toBe(65);
  });

  it('lists the most confident category mistakes first, ties by id, at most five', () => {
    // Wrong on T04 .85, T06 .6, T08 .55, T11 .45, T09 .3, T10 .3: six, so T10 is cut after the id tie.
    expect(metrics.instructiveMisses).toEqual([
      { id: 'T04', predicted: 'Account Access', truth: 'Shipping/Order Issue', confidence: 0.85, topTerms: [{ term: 'word-T04', weight: 0.85 }] },
      { id: 'T06', predicted: 'Technical Issue', truth: 'Accessibility Support', confidence: 0.6, topTerms: [{ term: 'word-T06', weight: 0.6 }] },
      { id: 'T08', predicted: 'Product Question', truth: 'Urgent Complaint', confidence: 0.55, topTerms: [{ term: 'word-T08', weight: 0.55 }] },
      { id: 'T11', predicted: 'Technical Issue', truth: 'Account Access', confidence: 0.45, topTerms: [{ term: 'word-T11', weight: 0.45 }] },
      { id: 'T09', predicted: 'Product Question', truth: 'Other', confidence: 0.3, topTerms: [{ term: 'word-T09', weight: 0.3 }] },
    ]);
  });
});

describe('computeMetrics edges', () => {
  it('reports no overrides, no flags and no misses when nothing was reviewed', () => {
    const [first] = TRAILS;
    if (first === undefined) throw new Error('E_TEST_FIXTURE');
    const metrics = computeMetrics([first], truthOf);
    expect(metrics.overrideRate).toBe(0);
    expect(metrics.flagRate).toBe(0);
    expect(metrics.flagsByReason).toEqual({});
    expect(metrics.instructiveMisses).toEqual([]);
  });

  it('refuses an empty run instead of dividing by zero', () => {
    expect(() => computeMetrics([], truthOf)).toThrow('E_EMPTY_RUN');
  });
});
