import { ROUTES, type Category, type Priority } from '../domain/labels';
import type { Prediction } from '../model/scorer';
import { runTicket, runTicketWith, type RunDeps } from '../pipeline/run';
import type { Reviewer, TicketTrail } from '../pipeline/types';

// The desk's rule for two models, as Part 1 measured it (`scripts/measureTwoModels.ts`).
// The word model is the gate: with the rules and the confidence floor it decides
// whether a ticket may leave unchecked. The sentence model gives the answer a
// person is shown. A ticket leaves unchecked only when the gate lets it and the
// sentence model's answer, after the same rules, is the same department and
// priority; so an unchecked ticket carries the gate's answer, and none of the
// error counts can be worse than the gate alone.

export interface ModelAnswer {
  category: Category;
  priority: Priority;
}

export interface TwoModelDeps extends RunDeps {
  // The sentence model's answer for a masked ticket.
  suggest(maskedText: string, id: string): ModelAnswer;
}

// The sentence model is compared with the gate, never used as one, so its own
// confidence flags nothing.
const NO_FLOOR = 0;

// Takes the suggestion as it is: the real reviewer is asked once, below.
const PASS_THROUGH: Reviewer = {
  decide: (input) => ({ ...input.suggestion, route: ROUTES[input.suggestion.category] }),
};

function certain(label: string): Prediction {
  return { label, confidence: 1, probabilities: {}, topTerms: [] };
}

/**
 * Runs one desk ticket through the pipeline with both models.
 *
 * Args:
 *   text: the ticket as typed.
 *   id: the ticket's id.
 *   deps: the word model and run settings, and the sentence model's answers.
 *
 * Returns:
 *   The gate's trail, with each model's answer under `models`; when a person is
 *   needed, the reviewer's decision on the sentence model's suggestion.
 */
export function runTwoModels(text: string, id: string, deps: TwoModelDeps): TicketTrail {
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
  const same = answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
  if (!gate.guard.flagged && !answer.guard.flagged && same) {
    return { ...gate, models };
  }
  const review = deps.reviewer.decide({ id, maskedText: gate.maskedText, suggestion: sentence, reasons: gate.guard.reasons });
  // The card shows the suggestion through the trail's own answer. A disagreeing
  // sentence answer carries no "sure" percent: its probabilities are not on the
  // word model's scale, so it never offers a quick approve.
  const shown = same ? gate : { ...gate, category: { ...certain(sentence.category), confidence: 0 }, priority: { ...certain(sentence.priority), confidence: 0 } };
  return {
    ...shown,
    models,
    guard: { ...gate.guard, flagged: true, priority: sentence.priority },
    review,
    final: { category: review.category, priority: review.priority, route: review.route, by: 'reviewer' },
  };
}
