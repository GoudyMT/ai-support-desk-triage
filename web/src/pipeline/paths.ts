import type { TicketLabel } from '../domain/labels';
import type { TicketTrail } from './types';

// What every reader of a trail asks: did it wait for the operator, and did a person handle it? A three-path trail
// (the desk with both models) answers by its path; any other trail by its flag, as the one-model flow always has.

export function toOperator(trail: TicketTrail): boolean {
  return trail.path === undefined ? trail.guard.flagged : trail.path === 'triage';
}

// The operator checked it, or it reached its team marked as needing a person.
export function reachedPerson(trail: TicketTrail): boolean {
  return trail.path === undefined ? trail.guard.flagged : trail.path !== 'direct';
}

// A three-path trail is missed only for one of the five risk reasons: a vague ticket is a routing doubt. A one-model
// trail keeps its v1.1 meaning, every must-review ticket.
export function missedRisk(trail: TicketTrail, truth: TicketLabel): boolean {
  const risky = trail.path === undefined ? truth.mustReview : truth.mustReview && truth.reviewReason !== 'vague ticket';
  return risky && !reachedPerson(trail);
}
