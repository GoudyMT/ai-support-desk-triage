import { v0Triage } from '../baseline/v0';
import { ROUTES, type Category, type Priority } from '../domain/labels';
import { score, type Model } from '../model/scorer';
import { maskText } from '../privacy/mask';
import { guard, secondCheck } from './guard';
import { intake } from './intake';
import type { Reviewer, TicketTrail } from './types';

// Set by the owner from the per-fold measurement (2026-10-31): at 0.5 no hand-written
// high-risk ticket is missed; zero on every generated fold needed 0.8, which sends
// nearly every ticket to a person.
export const CONFIDENCE_FLOOR = 0.5;
// Off: at this floor, clearing low-confidence flags added 2 to 49 misses per fold
// and one on the fresh hand-written set.
export const SECOND_CHECK_ON = false;

export interface RunDeps {
  model: Model;
  reviewer: Reviewer;
  floor: number;
  secondCheckOn: boolean;
  now: () => number;
}

/**
 * Runs one ticket through intake, privacy, classify, guardrails, review and done.
 *
 * @param text The ticket as typed. Only v0 and the masker read it; the trail keeps none of it.
 * @param id The ticket's id.
 * @param deps The model, reviewer, confidence floor, second-check switch and clock.
 * @returns The ticket's trail: what each stage decided.
 * @throws Error('E_EMPTY_TICKET') or Error('E_TICKET_TOO_LONG') from intake.
 */
export function runTicket(text: string, id: string, deps: RunDeps): TicketTrail {
  const t0 = deps.now();
  const record = intake(text, id, t0);
  // v0 read the raw text on the original page, so the comparison feeds it the same;
  // only its answer is kept.
  const v0 = v0Triage(record.text);
  const { text: maskedText, found } = maskText(record.text);
  const category = score(deps.model, 'category', maskedText);
  const priority = score(deps.model, 'priority', maskedText);
  const checked = guard(category, priority.label as Priority, maskedText, deps.floor);
  const result = deps.secondCheckOn ? secondCheck(checked, category) : checked;
  const modelCategory = category.label as Category;

  if (!result.flagged) {
    return {
      id,
      receivedAt: record.receivedAt,
      maskedText,
      found,
      category,
      priority,
      guard: result,
      final: { category: modelCategory, priority: result.priority, route: ROUTES[modelCategory], by: 'model' },
      v0,
      ms: deps.now() - t0,
    };
  }
  const review = deps.reviewer.decide({
    id,
    maskedText,
    suggestion: { category: modelCategory, priority: result.priority },
    reasons: result.reasons,
  });
  return {
    id,
    receivedAt: record.receivedAt,
    maskedText,
    found,
    category,
    priority,
    guard: result,
    review,
    final: { category: review.category, priority: review.priority, route: review.route, by: 'reviewer' },
    v0,
    ms: deps.now() - t0,
  };
}

export function runTickets(tickets: { id: string; text: string }[], deps: RunDeps): TicketTrail[] {
  return tickets.map((ticket) => runTicket(ticket.text, ticket.id, deps));
}
