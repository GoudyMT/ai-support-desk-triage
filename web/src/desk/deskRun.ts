import { generateTicket, type Ticket } from '../generator/generate';
import type { Wording } from '../generator/wording';
import type { Model } from '../model/scorer';
import type { SentenceModel } from '../model/sentenceScorer';
import { maskText } from '../privacy/mask';
import { createDeskSchedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener } from '../run/prescreen';
import { runTwoModels, type ModelAnswer } from '../run/twoModels';

// The desk's run: tickets in wording no model trained on (the desk wording,
// generator/deskFrames.ts), the shipped word model as the gate and, when the
// sentence model has loaded, its answer as the suggestion (the two-model rule,
// run/twoModels.ts). The demo page keeps its fold tickets and one model. The
// wording is passed in: it is fetched on demand with the sentence model's code.

export type Suggest = (maskedText: string, id: string) => ModelAnswer;

export interface DeskRunOptions {
  seed: number;
  wording: Wording;
  model: Model;
  // Unset for a run on the word model only (the larger model did not load, or the viewer chose not to wait).
  suggest: Suggest | undefined;
  wallClock: () => number;
  closeEveryMs: number;
}

/**
 * The tickets a desk run of this seed brings, in order.
 *
 * Args:
 *   seed: the run's seed.
 *   wording: the desk wording.
 *
 * Returns:
 *   One ticket per arrival of the desk's schedule.
 */
export function deskTickets(seed: number, wording: Wording): Ticket[] {
  return Array.from({ length: createDeskSchedule(seed).total }, (_, index) => generateTicket(seed, index, 'all', wording));
}

/**
 * Answers each ticket from the sentence model's answers, worked out before the run.
 *
 * Returns:
 *   A Suggest that throws Error('E_SUGGESTION_MISSING') for a ticket it has no
 *   answer for, rather than let it out on one model.
 */
export function suggestFrom(answers: ReadonlyMap<string, ModelAnswer>): Suggest {
  return (_maskedText, id) => {
    const answer = answers.get(id);
    if (answer === undefined) {
      throw new Error('E_SUGGESTION_MISSING');
    }
    return answer;
  };
}

/**
 * Asks the sentence model for its answer on every ticket of a run, before the run starts.
 *
 * The model answers asynchronously and the run does not wait, so its answers are
 * worked out first; the masked text is what the run will give the model.
 *
 * Args:
 *   model: the sentence model.
 *   tickets: the run's tickets (deskTickets).
 *
 * Returns:
 *   Each ticket's answer by id, for suggestFrom.
 */
export async function scoreDesk(model: SentenceModel, tickets: readonly Ticket[]): Promise<Map<string, ModelAnswer>> {
  const answers = new Map<string, ModelAnswer>();
  for (const ticket of tickets) {
    const { category, priority } = await model.predict(maskText(ticket.text).text);
    answers.set(ticket.id, { category, priority });
  }
  return answers;
}

export function createDeskRun(opts: DeskRunOptions): Run {
  const { seed, wording, model, suggest, wallClock, closeEveryMs } = opts;
  const run = {
    seed,
    model,
    schedule: createDeskSchedule(seed),
    wallClock,
    prescreen: createPrescreener(model),
    closeEveryMs,
    deepTickets: 0,
    ticketAt: (index: number) => generateTicket(seed, index, 'all', wording),
  };
  return createRun(suggest === undefined ? run : { ...run, runOne: (text, id, deps) => runTwoModels(text, id, { ...deps, suggest }) });
}
