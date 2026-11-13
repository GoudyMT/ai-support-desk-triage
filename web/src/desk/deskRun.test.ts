import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESK_WORDING } from '../generator/deskFrames';
import { generateTicket } from '../generator/generate';
import { loadModel } from '../model/scorer';
import { maskText } from '../privacy/mask';
import type { TicketTrail } from '../pipeline/types';
import { createDeskRun, deskTickets, scoreDesk, suggestFrom } from './deskRun';

// The desk runs on wording no model trained on (DESK_WORDING), with the shipped
// word model as the gate and, once loaded, the sentence model's suggestions.

const MODEL = loadModel(JSON.parse(readFileSync(new URL('../model/model.json', import.meta.url), 'utf8')));
const SEED = 4242;
const PACE_MS = 2500;

// A stand-in for the sentence model's answers: the true department, priority one step up.
function standInSuggestions(seed: number) {
  const tickets = deskTickets(seed, DESK_WORDING);
  return new Map(tickets.map((ticket) => [ticket.id, { category: ticket.label.category, priority: ticket.label.priority === 'Low' ? 'Medium' : ticket.label.priority }] as const));
}

function finished(suggestions: ReturnType<typeof standInSuggestions> | undefined, seed = SEED): { done: TicketTrail[]; truthOf: (id: string) => unknown } {
  const run = createDeskRun({ seed, wording: DESK_WORDING, model: MODEL, suggest: suggestions === undefined ? undefined : suggestFrom(suggestions), wallClock: () => 0, closeEveryMs: PACE_MS });
  run.finishNow();
  return { done: run.state().done, truthOf: run.truthOf };
}

const withoutMs = (trails: TicketTrail[]) => trails.map((trail) => ({ ...trail, ms: 0 }));

describe('the desk run', () => {
  it('draws only desk-only tickets, never a fold of the practice wording', () => {
    const tickets = deskTickets(SEED, DESK_WORDING);
    expect(tickets.length).toBeGreaterThan(0);
    tickets.forEach((ticket, index) => expect(ticket).toEqual(generateTicket(SEED, index, 'all', DESK_WORDING)));
    const { done, truthOf } = finished(standInSuggestions(SEED));
    expect(done.map((trail) => trail.id).sort()).toEqual(tickets.map((ticket) => ticket.id).sort());
    for (const ticket of tickets) {
      expect(truthOf(ticket.id)).toEqual(ticket.label);
      expect(done.find((trail) => trail.id === ticket.id)?.maskedText).toBe(maskText(ticket.text).text);
    }
  });

  it('replays a seed: the same tickets and the same answers', () => {
    expect(withoutMs(finished(standInSuggestions(SEED)).done)).toEqual(withoutMs(finished(standInSuggestions(SEED)).done));
    expect(withoutMs(finished(standInSuggestions(SEED + 1), SEED + 1).done)).not.toEqual(withoutMs(finished(standInSuggestions(SEED)).done));
  });

  it('records both models on every ticket of a two-model run, and neither on a word-model-only run', () => {
    expect(finished(standInSuggestions(SEED)).done.every((trail) => trail.models !== undefined)).toBe(true);
    const wordOnly = finished(undefined).done;
    expect(wordOnly.every((trail) => trail.models === undefined)).toBe(true);
    expect(withoutMs(wordOnly).map((trail) => trail.id).sort()).toEqual(deskTickets(SEED, DESK_WORDING).map((ticket) => ticket.id).sort());
  });

  it('asks the sentence model about every ticket of the run, on the text the run gives it', async () => {
    const asked: string[] = [];
    const model = {
      predict: async (maskedText: string) => {
        asked.push(maskedText);
        return { category: 'Billing' as const, priority: 'High' as const, categoryProbability: 0.5, priorityProbability: 0.5 };
      },
    };
    const answers = await scoreDesk(model, deskTickets(SEED, DESK_WORDING));
    expect([...answers.keys()]).toEqual(deskTickets(SEED, DESK_WORDING).map((ticket) => ticket.id));
    expect(asked).toEqual(deskTickets(SEED, DESK_WORDING).map((ticket) => maskText(ticket.text).text));
    expect([...answers.values()].every((answer) => answer.category === 'Billing' && answer.priority === 'High')).toBe(true);
  });

  it('refuses a ticket with no suggestion instead of letting it out on one model', () => {
    const partial = new Map([...standInSuggestions(SEED)].slice(1));
    const run = createDeskRun({ seed: SEED, wording: DESK_WORDING, model: MODEL, suggest: suggestFrom(partial), wallClock: () => 0, closeEveryMs: PACE_MS });
    expect(() => run.finishNow()).toThrow('E_SUGGESTION_MISSING');
  });
});
