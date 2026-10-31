import { CATEGORIES, ROUTES, type Category, type ReviewReason, type TicketLabel } from '../domain/labels';
import { createRng, ticketSeed } from '../generator/rng';
import type { Reviewer } from './types';

// An assumption the page shows: a careful person still slips now and then.
export const REVIEWER_ERROR_RATE = 0.05;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// What the ticket is about, as the middle of the reviewer's explanation.
const REASON_PHRASES: Record<ReviewReason, string> = {
  'security incident': 'the ticket reports a security incident',
  'accessibility issue': 'the ticket describes an accessibility problem',
  'billing dispute': 'the ticket disputes a charge',
  'threatening language': 'the ticket threatens staff',
  'escalated complaint': 'the ticket is an escalated complaint',
  'vague ticket': 'the ticket is too vague to place',
};

function hashId(id: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return hash;
}

function explain(suggested: Category, decided: Category, truth: TicketLabel): string {
  const why = truth.reviewReason === undefined ? `the ticket is about ${decided}` : REASON_PHRASES[truth.reviewReason];
  return `The model said ${suggested}; ${why}, so it goes to ${decided}.`;
}

export function createSimulatedReviewer(
  seed: number,
  truthOf: (id: string) => TicketLabel,
  errorRate: number = REVIEWER_ERROR_RATE,
): Reviewer {
  return {
    decide(input) {
      const truth = truthOf(input.id);
      // Only the seed and this ticket's id feed the draw, so a ticket's decision never
      // depends on which other tickets were flagged or in what order.
      const rng = createRng(ticketSeed(seed, hashId(input.id)));
      const category = rng.chance(errorRate)
        ? rng.pick(CATEGORIES.filter((c) => c !== truth.category))
        : truth.category;
      const decision = { category, priority: truth.priority, route: ROUTES[category] };
      return category === input.suggestion.category
        ? decision
        : { ...decision, reason: explain(input.suggestion.category, category, truth) };
    },
  };
}
