import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  PRIORITIES,
  ROUTES,
  type Category,
  type ReviewReason,
  type TicketLabel,
} from '../domain/labels';
import type { ReviewDecision, ReviewInput } from './types';
import { createSimulatedReviewer, REVIEWER_ERROR_RATE } from './reviewer';

const SEED = 20261031;
const REASONS: (ReviewReason | undefined)[] = [
  undefined,
  'security incident',
  'accessibility issue',
  'billing dispute',
  'threatening language',
  'escalated complaint',
  'vague ticket',
];

// Ids look like the generator's (a prefix and a number); the answer depends only on the number.
function idOf(n: number): string {
  return `ticket-${n}`;
}

function truthOf(id: string): TicketLabel {
  const match = /^ticket-(\d+)$/.exec(id);
  if (match === null) {
    throw new Error('E_UNKNOWN_TICKET');
  }
  const n = Number(match[1]);
  const label: TicketLabel = {
    category: CATEGORIES[n % CATEGORIES.length] as Category,
    priority: PRIORITIES[n % PRIORITIES.length] as TicketLabel['priority'],
    mustReview: true,
  };
  const reviewReason = REASONS[n % REASONS.length];
  return reviewReason === undefined ? label : { ...label, reviewReason };
}

// A suggestion that is never the true category, so the model is always "wrong" here.
function wrongInput(n: number): ReviewInput {
  const truth = truthOf(idOf(n));
  const suggested = CATEGORIES[(CATEGORIES.indexOf(truth.category) + 1) % CATEGORIES.length] as Category;
  return {
    id: idOf(n),
    maskedText: 'masked text',
    suggestion: { category: suggested, priority: 'Low' },
    reasons: [],
  };
}

function agreeingInput(n: number): ReviewInput {
  const truth = truthOf(idOf(n));
  return {
    id: idOf(n),
    maskedText: 'masked text',
    suggestion: { category: truth.category, priority: truth.priority },
    reasons: [],
  };
}

function decideMany(count: number, seed = SEED, errorRate?: number): ReviewDecision[] {
  const reviewer = createSimulatedReviewer(seed, truthOf, errorRate);
  return Array.from({ length: count }, (_, n) => reviewer.decide(agreeingInput(n)));
}

describe('simulated reviewer', () => {
  it('replays exactly from the same seed and differs under another seed', () => {
    expect(decideMany(1000)).toEqual(decideMany(1000));
    expect(decideMany(1000, SEED + 1)).not.toEqual(decideMany(1000));
  });

  it('decides a ticket the same whether it is asked alone or after 500 others', () => {
    const alone = createSimulatedReviewer(SEED, truthOf);
    const busy = createSimulatedReviewer(SEED, truthOf);
    for (let n = 1000; n < 1500; n++) {
      busy.decide(agreeingInput(n));
    }
    for (let n = 0; n < 200; n++) {
      expect(busy.decide(agreeingInput(n))).toEqual(alone.decide(agreeingInput(n)));
    }
  });

  it('is wrong about 5 percent of the time over 10,000 tickets', () => {
    const decisions = decideMany(10000);
    const wrong = decisions.filter((d, n) => d.category !== truthOf(idOf(n)).category).length;
    expect(Math.abs(wrong / 10000 - REVIEWER_ERROR_RATE)).toBeLessThanOrEqual(0.01);
  });

  it('gives the true answer every time when the error rate is zero', () => {
    decideMany(2000, SEED, 0).forEach((d, n) => {
      const truth = truthOf(idOf(n));
      expect(d.category).toBe(truth.category);
      expect(d.priority).toBe(truth.priority);
    });
  });

  it('never returns the true category on an error and always keeps the true priority', () => {
    const decisions = decideMany(2000, SEED, 1);
    decisions.forEach((d, n) => {
      const truth = truthOf(idOf(n));
      expect(d.category).not.toBe(truth.category);
      expect(d.priority).toBe(truth.priority);
    });
    expect(new Set(decisions.map((d) => d.category)).size).toBeGreaterThan(5);
  });

  it('names both categories when it overrules the model and says nothing when it agrees', () => {
    const reviewer = createSimulatedReviewer(SEED, truthOf, 0);
    for (let n = 0; n < 50; n++) {
      const input = wrongInput(n);
      const decision = reviewer.decide(input);
      expect(decision.reason).toContain(`The model said ${input.suggestion.category};`);
      expect(decision.reason).toContain(`so it goes to ${decision.category}.`);
      expect(reviewer.decide(agreeingInput(n)).reason).toBeUndefined();
    }
  });

  it('gives the ticket reason in plain words, or the category when it has none', () => {
    const reviewer = createSimulatedReviewer(SEED, truthOf, 0);
    const withReason = reviewer.decide(wrongInput(4));
    expect(truthOf(idOf(4)).reviewReason).toBe('threatening language');
    expect(withReason.reason).toContain('threatens');
    const noReason = reviewer.decide(wrongInput(0));
    expect(truthOf(idOf(0)).reviewReason).toBeUndefined();
    expect(noReason.reason).toContain(`the ticket is about ${noReason.category}`);
  });

  it('routes every decision to the team for its decided category', () => {
    for (const d of decideMany(2000)) {
      expect(d.route).toBe(ROUTES[d.category]);
    }
  });

  it('lets an unknown ticket id fail loudly instead of guessing', () => {
    const reviewer = createSimulatedReviewer(SEED, truthOf);
    expect(() => reviewer.decide({ ...agreeingInput(1), id: 'nope' })).toThrow('E_UNKNOWN_TICKET');
  });
});
