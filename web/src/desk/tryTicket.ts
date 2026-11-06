// What Try a ticket shows for a typed ticket. Pure: no DOM, so a test reads it directly. The text shown back is the
// masked text, never what was typed.
import { ROUTES } from '../domain/labels';
import type { Model } from '../model/scorer';
import { tagView, whyFlagged } from '../page/view';
import { intake } from '../pipeline/intake';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer } from '../pipeline/types';

export interface TryView {
  text: string;
  category: string;
  priority: string;
  team: string;
  person: string;
}

export type Refusal = 'empty' | 'long';

const TRY_ID = 'try';

// A typed ticket has no true answer, so the stand-in for the reviewer accepts the suggestion as it is.
const ACCEPTS: Reviewer = {
  decide: ({ suggestion }) => ({ ...suggestion, route: ROUTES[suggestion.category] }),
};

// The same two refusals intake makes, asked before any model is fetched.
export function refusal(text: string): Refusal | undefined {
  try {
    intake(text, TRY_ID, 0);
  } catch (error) {
    return error instanceof Error && error.message === 'E_EMPTY_TICKET' ? 'empty' : 'long';
  }
  return undefined;
}

// The same sentence form the cards use for a reason.
function sentence(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/**
 * Sorts one typed ticket on the shipped model.
 *
 * @param text The ticket as typed; it must have passed `refusal`.
 * @param model The shipped model.
 * @returns What the visitor sees: the masked text and the final category, priority, team and whether a person is needed.
 */
export function tryTicket(text: string, model: Model): TryView {
  const trail = runTicket(text, TRY_ID, {
    model,
    reviewer: ACCEPTS,
    floor: CONFIDENCE_FLOOR,
    secondCheckOn: SECOND_CHECK_ON,
    now: Date.now,
  });
  return {
    text: trail.maskedText,
    category: trail.final.category,
    priority: tagView(trail.final.priority).word,
    team: trail.final.route,
    person: trail.guard.flagged ? `Yes: ${sentence(whyFlagged(trail))}` : 'No',
  };
}
