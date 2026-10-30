import { describe, expect, it } from 'vitest';
import type { Category } from './labels';
import { labelTicket, primaryCategory, type TicketFacts } from './labelRules';

// Written out here, not read from RISK_ORDER, so a reordered constant cannot
// make the expected answers move with it.
const EXPECTED_RISK_ORDER: readonly Category[] = [
  'Security Concern',
  'Accessibility Support',
  'Urgent Complaint',
  'Billing',
  'Account Access',
  'Technical Issue',
  'Shipping/Order Issue',
  'Product Question',
  'Other',
];

function facts(overrides: Partial<TicketFacts> = {}): TicketFacts {
  return {
    issues: ['Product Question'],
    threatening: false,
    vague: false,
    billingDispute: false,
    severe: false,
    statusQuestion: false,
    ...overrides,
  };
}

describe('rule 1: a threat is an urgent complaint that must be reviewed', () => {
  it('labels it Urgent Complaint / Urgent and keeps the underlying issue as secondary', () => {
    expect(labelTicket(facts({ issues: ['Billing'], threatening: true }))).toEqual({
      category: 'Urgent Complaint',
      secondary: 'Billing',
      priority: 'Urgent',
      mustReview: true,
      reviewReason: 'threatening language',
    });
  });

  it('takes the secondary from the riskiest of two issues', () => {
    const label = labelTicket(
      facts({ issues: ['Technical Issue', 'Account Access'], threatening: true }),
    );
    expect(label.secondary).toBe('Account Access');
  });

  it('takes the same secondary when the riskiest issue is listed first', () => {
    const label = labelTicket(
      facts({ issues: ['Account Access', 'Technical Issue'], threatening: true }),
    );
    expect(label.secondary).toBe('Account Access');
  });

  it('omits the secondary when the threat is raised on an urgent complaint itself', () => {
    const label = labelTicket(facts({ issues: ['Urgent Complaint'], threatening: true }));
    expect(label).toEqual({
      category: 'Urgent Complaint',
      priority: 'Urgent',
      mustReview: true,
      reviewReason: 'threatening language',
    });
    expect(label).not.toHaveProperty('secondary');
  });

  it('beats vague when a ticket is both', () => {
    expect(
      labelTicket(facts({ issues: ['Product Question'], threatening: true, vague: true })),
    ).toEqual({
      category: 'Urgent Complaint',
      secondary: 'Product Question',
      priority: 'Urgent',
      mustReview: true,
      reviewReason: 'threatening language',
    });
  });
});

describe('rule 2: a vague ticket is Other and must be reviewed', () => {
  it('labels it Other / Medium with no secondary', () => {
    const label = labelTicket(facts({ issues: ['Billing'], vague: true }));
    expect(label).toEqual({
      category: 'Other',
      priority: 'Medium',
      mustReview: true,
      reviewReason: 'vague ticket',
    });
    expect(label).not.toHaveProperty('secondary');
  });
});

describe('rule 3: the riskiest issue is the category, the other is secondary', () => {
  it('has no secondary for one issue', () => {
    const label = labelTicket(facts({ issues: ['Account Access'] }));
    expect(label.category).toBe('Account Access');
    expect(label).not.toHaveProperty('secondary');
  });

  it('puts the riskier of two issues first whatever order they arrive in', () => {
    const forward = labelTicket(facts({ issues: ['Billing', 'Product Question'] }));
    const backward = labelTicket(facts({ issues: ['Product Question', 'Billing'] }));
    expect(forward.category).toBe('Billing');
    expect(forward.secondary).toBe('Product Question');
    expect(backward.category).toBe('Billing');
    expect(backward.secondary).toBe('Product Question');
  });

  it('refuses a ticket with no issue instead of guessing a label', () => {
    expect(() => primaryCategory([])).toThrow('E_NO_ISSUES');
  });
});

describe('rule 3: risk order, checked on each neighbouring pair', () => {
  // Two neighbours swapped in the order is the plausible slip; the order is a
  // single list, so its neighbours (both ways round) pin every position.
  const pairs = EXPECTED_RISK_ORDER.flatMap((higher, i): [Category, Category][] => {
    const lower = EXPECTED_RISK_ORDER[i + 1];
    return lower === undefined
      ? []
      : [
          [higher, lower],
          [lower, higher],
        ];
  });

  it.each(pairs)('primaryCategory([%s, %s]) is the one earlier in the risk order', (a, b) => {
    const expected =
      EXPECTED_RISK_ORDER.indexOf(a) < EXPECTED_RISK_ORDER.indexOf(b) ? a : b;
    expect(primaryCategory([a, b])).toBe(expected);
  });
});

describe('rule 4: priority by category', () => {
  const cases: [string, Partial<TicketFacts>, string][] = [
    ['Security Concern', {}, 'Urgent'],
    ['Accessibility Support', {}, 'High'],
    ['Account Access', {}, 'High'],
    ['Urgent Complaint', {}, 'High'],
    ['Billing', {}, 'Medium'],
    ['Billing', { severe: true }, 'High'],
    ['Technical Issue', {}, 'Medium'],
    ['Technical Issue', { severe: true }, 'High'],
    ['Shipping/Order Issue', {}, 'Medium'],
    ['Shipping/Order Issue', { statusQuestion: true }, 'Low'],
    ['Product Question', {}, 'Low'],
    ['Other', {}, 'Low'],
    // A flag on a category it does not apply to must change nothing.
    ['Security Concern', { severe: true, statusQuestion: true }, 'Urgent'],
    ['Shipping/Order Issue', { severe: true }, 'Medium'],
    ['Billing', { statusQuestion: true }, 'Medium'],
    ['Technical Issue', { statusQuestion: true }, 'Medium'],
  ];

  it.each(cases)('%s with %j is %s', (category, flags, priority) => {
    const label = labelTicket(facts({ issues: [category as Category], ...flags }));
    expect(label.category).toBe(category);
    expect(label.priority).toBe(priority);
  });

  it('judges priority by the riskiest issue, not by a flag that fits the other one', () => {
    expect(
      labelTicket(facts({ issues: ['Shipping/Order Issue', 'Security Concern'], statusQuestion: true })),
    ).toEqual({
      category: 'Security Concern',
      secondary: 'Shipping/Order Issue',
      priority: 'Urgent',
      mustReview: true,
      reviewReason: 'security incident',
    });
  });
});

describe('rule 5: which tickets must be reviewed', () => {
  const reviewed: [Category, Partial<TicketFacts>, string][] = [
    ['Security Concern', {}, 'security incident'],
    ['Accessibility Support', {}, 'accessibility issue'],
    ['Billing', { billingDispute: true }, 'billing dispute'],
    ['Urgent Complaint', {}, 'escalated complaint'],
  ];

  it.each(reviewed)('%s with %j needs review: %s', (category, flags, reason) => {
    const label = labelTicket(facts({ issues: [category], ...flags }));
    expect(label.mustReview).toBe(true);
    expect(label.reviewReason).toBe(reason);
  });

  const notReviewed: [Category, Partial<TicketFacts>][] = [
    ['Billing', {}],
    ['Billing', { severe: true }],
    ['Account Access', {}],
    ['Technical Issue', {}],
    ['Shipping/Order Issue', {}],
    ['Product Question', {}],
    ['Other', {}],
  ];

  it.each(notReviewed)('%s with %j needs no review', (category, flags) => {
    const label = labelTicket(facts({ issues: [category], ...flags }));
    expect(label.mustReview).toBe(false);
    expect(label).not.toHaveProperty('reviewReason');
  });

  it('ignores billingDispute when billing is not the category', () => {
    const label = labelTicket(facts({ issues: ['Technical Issue'], billingDispute: true }));
    expect(label.mustReview).toBe(false);
  });
});
