import { PRIORITIES, ROUTES, type Category, type Priority } from '../domain/labels';
import type { Prediction } from '../model/scorer';
import { runTicket, runTicketWith } from '../pipeline/run';
import type { FlagReason, Reviewer, TicketTrail } from '../pipeline/types';
import type { TwoModelDeps } from './twoModels';

// The desk's flow with both models, as `scripts/measureSplit.ts` measures it. Routing and risk are separate jobs:
// a person at the operator's desk checks a ticket only when the word model and the sentence model, after the
// rules, disagree on its department or priority, or when the only flag says it is too vague to place. Every other
// ticket goes straight to the team both models named. A word rule, an always-checked department or the word
// model's doubt (under the confidence floor) marks it as needing a person there, and a marked ticket is never
// left below High, so a risky ticket the models placed too low still reaches its team as urgent work.

export const MARK_FLOOR_PRIORITY: Priority = 'High';

// The sentence model is compared with the word model, never used as a gate, so its own confidence flags nothing.
const NO_FLOOR = 0;

// Takes the suggestion as it is: the real reviewer is asked at most once, below.
const PASS_THROUGH: Reviewer = {
  decide: (input) => ({ ...input.suggestion, route: ROUTES[input.suggestion.category] }),
};

function certain(label: string): Prediction {
  return { label, confidence: 1, probabilities: {}, topTerms: [] };
}

function ruleNames(reasons: readonly FlagReason[]): string[] {
  return reasons.flatMap((reason) => (reason.kind === 'rule' ? [reason.reason] : []));
}

// A rule other than the vague one, or a department that is always checked: what makes a ticket risky to the desk.
function riskFlagged(reasons: readonly FlagReason[]): boolean {
  return ruleNames(reasons).some((name) => name !== 'vague ticket') || reasons.some((reason) => reason.kind === 'category');
}

// The vague rule says where a ticket goes is unclear: a routing doubt, so the operator places it.
function onlyVague(reasons: readonly FlagReason[]): boolean {
  const names = ruleNames(reasons);
  return names.length > 0 && names.every((name) => name === 'vague ticket') && !reasons.some((reason) => reason.kind === 'category');
}

function atLeast(priority: Priority, floor: Priority): Priority {
  return PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(floor) ? floor : priority;
}

/**
 * Puts one desk ticket on its path: an operator card, its team marked as needing a person, or its team unmarked.
 *
 * Args:
 *   text: the ticket as typed.
 *   id: the ticket's id.
 *   deps: the word model and run settings, and the sentence model's answers.
 *
 * Returns:
 *   The word model's trail with `path`, `marked` and each model's answer under `models`; for an operator card,
 *   the reviewer's decision on the sentence model's suggestion.
 */
export function routeTicket(text: string, id: string, deps: TwoModelDeps): TicketTrail {
  const gate = runTicket(text, id, { ...deps, reviewer: PASS_THROUGH });
  const said = deps.suggest(gate.maskedText, id);
  const answer = runTicketWith(text, id, (head) => certain(head === 'category' ? said.category : said.priority), {
    ...deps,
    reviewer: PASS_THROUGH,
    floor: NO_FLOOR,
  });
  const word = { category: gate.category.label as Category, priority: gate.guard.priority };
  const sentence = { category: answer.category.label as Category, priority: answer.guard.priority };
  const models = { word, sentence };
  const reasons = gate.guard.reasons;
  const risky = riskFlagged(reasons);
  const same = answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;

  if (!same || onlyVague(reasons)) {
    const review = deps.reviewer.decide({ id, maskedText: gate.maskedText, suggestion: sentence, reasons });
    // A suggestion that differs from the word model's carries no "sure" percent: its probabilities are not on the
    // word model's scale.
    const shown = same ? gate : { ...gate, category: { ...certain(sentence.category), confidence: 0 }, priority: { ...certain(sentence.priority), confidence: 0 } };
    return {
      ...shown,
      models,
      guard: { ...gate.guard, flagged: true, priority: sentence.priority },
      review,
      final: { category: review.category, priority: review.priority, route: review.route, by: 'reviewer' },
      path: 'triage',
      marked: risky,
    };
  }
  if (gate.guard.flagged) {
    // No person decided anything yet, so the pass-through review is not kept.
    const unreviewed: TicketTrail = { ...gate };
    delete unreviewed.review;
    const priority = atLeast(gate.final.priority, MARK_FLOOR_PRIORITY);
    return { ...unreviewed, models, final: { ...gate.final, priority, by: 'model' }, path: 'marked', marked: true };
  }
  return { ...gate, models, path: 'direct', marked: false };
}
