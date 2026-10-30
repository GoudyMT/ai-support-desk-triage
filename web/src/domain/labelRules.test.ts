import { describe, expect, it } from 'vitest';
import { CATEGORIES, ROUTES, RISK_ORDER, type Category } from './labels';
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

describe('rule 3: risk order for every pair of categories', () => {
  const pairs = EXPECTED_RISK_ORDER.flatMap((a) =>
    EXPECTED_RISK_ORDER.filter((b) => b !== a).map((b): [Category, Category] => [a, b]),
  );

  it('covers all 72 ordered pairs', () => {
    expect(pairs).toHaveLength(72);
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
  ];

  it.each(cases)('%s with %j is %s', (category, flags, priority) => {
    const label = labelTicket(facts({ issues: [category as Category], ...flags }));
    expect(label.category).toBe(category);
    expect(label.priority).toBe(priority);
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

describe('ROUTES', () => {
  it('has exactly one route per category with the agreed team names', () => {
    expect(Object.keys(ROUTES)).toHaveLength(9);
    expect(ROUTES).toEqual({
      Billing: 'Billing Team',
      'Technical Issue': 'Technical Support',
      'Account Access': 'Account Support',
      'Security Concern': 'Security Team',
      'Accessibility Support': 'Accessibility Team',
      'Product Question': 'Product Specialists',
      'Urgent Complaint': 'Escalations Team',
      'Shipping/Order Issue': 'Fulfillment Team',
      Other: 'General Support',
    });
  });
});

describe('category lists', () => {
  it('RISK_ORDER holds every category exactly once, in the agreed order', () => {
    expect([...RISK_ORDER]).toEqual([...EXPECTED_RISK_ORDER]);
    expect([...RISK_ORDER].sort()).toEqual([...CATEGORIES].sort());
  });
});
