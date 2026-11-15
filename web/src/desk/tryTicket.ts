// What Try a ticket shows for a typed ticket. Pure: no DOM, so a test reads it directly. The text shown back is the
// masked text, never what was typed.
import { ROUTES } from '../domain/labels';
import type { Model } from '../model/scorer';
import type { SentenceAnswer, SentenceModel } from '../model/sentenceScorer';
import { maskText } from '../privacy/mask';
import { tagView } from '../page/view';
import { intake } from '../pipeline/intake';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import { reachedPerson } from '../pipeline/paths';
import type { Reviewer, TicketPath } from '../pipeline/types';
import { routeTicket } from '../run/splitFlow';
import type { ModelAnswer } from '../run/twoModels';
import { deskWhy } from './view';

export interface TryView {
  text: string;
  category: string;
  priority: string;
  team: string;
  person: string;
  // With both models: which of the desk's three paths the ticket took.
  path?: string;
  // The result as one plain sentence, for a screen reader.
  spoken: string;
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

/**
 * Sorts one typed ticket on the shipped model, and with the sentence model's answer when it has one (the desk's
 * two-model rule).
 *
 * @param text The ticket as typed; it must have passed `refusal`.
 * @param model The shipped model.
 * @param sentenceAnswer The sentence model's answer on the masked ticket, or undefined when it did not load.
 * @returns What the visitor sees: the masked text and the final category, priority, team and whether a person is needed,
 *   and the same result as one sentence.
 */
/**
 * The sentence model's answer on a typed ticket, asked on the masked text.
 *
 * @param source Gives the sentence model, or undefined when it did not load.
 * @param text The ticket as typed; it must have passed `refusal`.
 * @returns The answer, or undefined when the model did not load or failed while answering, so the ticket is sorted on
 *   the word model alone.
 */
export async function sentenceAnswerFor(source: () => Promise<SentenceModel | undefined>, text: string): Promise<SentenceAnswer | undefined> {
  try {
    const model = await source();
    return await model?.predict(maskText(intake(text, TRY_ID, 0).text).text);
  } catch {
    return undefined;
  }
}

const PATH_WORDS: Record<TicketPath, string> = {
  triage: 'Check the route',
  marked: 'Marked: needs a person',
  direct: 'Straight to the team',
};

export function tryTicket(text: string, model: Model, sentenceAnswer?: ModelAnswer): TryView {
  const deps = { model, reviewer: ACCEPTS, floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: Date.now };
  const trail =
    sentenceAnswer === undefined ? runTicket(text, TRY_ID, deps) : routeTicket(text, TRY_ID, { ...deps, suggest: () => sentenceAnswer });
  const { category, route: team } = trail.final;
  const priority = tagView(trail.final.priority).word;
  const needed = reachedPerson(trail);
  const person = !needed ? 'No' : trail.path === 'marked' ? `Yes, at ${team}: ${deskWhy(trail)}` : `Yes: ${deskWhy(trail)}`;
  const path = trail.path === undefined ? undefined : PATH_WORDS[trail.path];
  const view: TryView = {
    text: trail.maskedText,
    category,
    priority,
    team,
    person,
    spoken: `Sorted: ${category}, ${priority}, ${team}.${path === undefined ? '' : ` ${path}.`} Person needed: ${needed ? 'yes' : 'no'}.`,
  };
  if (path !== undefined) view.path = path;
  return view;
}
