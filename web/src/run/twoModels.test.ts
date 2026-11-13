import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureTwoPredictors } from '../../scripts/measureTwoModels';
import type { Category, Priority } from '../domain/labels';
import { DESK_WORDING } from '../generator/deskFrames';
import { generateTickets } from '../generator/generate';
import { loadModel, score } from '../model/scorer';
import { guard } from '../pipeline/guard';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer, ReviewInput } from '../pipeline/types';
import { runTwoModels, type ModelAnswer } from './twoModels';

// The desk's rule for two models, as Part 1 measured it (`scripts/measureTwoModels.ts`):
// the word model is the gate; a ticket leaves unchecked only when the gate lets it
// and the sentence model gives the same department and priority; a person sees
// the sentence model's answer as the suggestion.

const MODEL = loadModel(JSON.parse(readFileSync(new URL('../model/model.json', import.meta.url), 'utf8')));
const DESK_SEED = 21;
const TICKETS = 400;
const TICKETS_LIST = generateTickets(DESK_SEED, TICKETS, 'all', DESK_WORDING);

function recordingReviewer(seen: ReviewInput[]): Reviewer {
  return {
    decide(input) {
      seen.push(input);
      return { ...input.suggestion, route: 'reviewed' };
    },
  };
}

const deps = (reviewer: Reviewer, suggest: (maskedText: string, id: string) => ModelAnswer) => ({
  model: MODEL,
  reviewer,
  floor: CONFIDENCE_FLOOR,
  secondCheckOn: SECOND_CHECK_ON,
  now: () => 0,
  suggest,
});

// The word model's own answer, so the two models agree on every ticket.
function wordAnswer(text: string, id: string): ModelAnswer {
  const trail = runTicket(text, id, { model: MODEL, reviewer: recordingReviewer([]), floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 });
  return { category: trail.category.label as Category, priority: trail.guard.priority };
}

const certain = (label: string) => ({ label, confidence: 1, probabilities: {}, topTerms: [] });

const OTHER_PRIORITY: Record<Priority, Priority> = { Low: 'Medium', Medium: 'Low', High: 'Urgent', Urgent: 'High' };

describe('runTwoModels', () => {
  it('lets a ticket out unchecked only when the gate lets it and both models agree', () => {
    const agreed = TICKETS_LIST.map((ticket) => {
      const word = wordAnswer(ticket.text, ticket.id);
      const trail = runTwoModels(ticket.text, ticket.id, deps(recordingReviewer([]), () => word));
      expect(trail.models).toEqual({ word, sentence: word });
      return trail;
    });
    const gateOnly = TICKETS_LIST.map((ticket) =>
      runTicket(ticket.text, ticket.id, { model: MODEL, reviewer: recordingReviewer([]), floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 }),
    );
    expect(agreed.map((trail) => trail.guard.flagged)).toEqual(gateOnly.map((trail) => trail.guard.flagged));
    // Agreeing models change nothing a card shows, its "sure" percent included.
    expect(agreed.map((trail) => [trail.category, trail.guard.priority])).toEqual(gateOnly.map((trail) => [trail.category, trail.guard.priority]));
    expect(agreed.some((trail) => !trail.guard.flagged)).toBe(true);
    for (const trail of agreed.filter((one) => !one.guard.flagged)) {
      expect(trail.final.by).toBe('model');
    }
  });

  it('sends a ticket the gate lets out to a person when the models disagree, with the sentence answer as the suggestion', () => {
    let checked = 0;
    let differed = 0;
    for (const ticket of TICKETS_LIST) {
      const word = wordAnswer(ticket.text, ticket.id);
      const sentence = { category: word.category, priority: OTHER_PRIORITY[word.priority] };
      const seen: ReviewInput[] = [];
      const trail = runTwoModels(ticket.text, ticket.id, deps(recordingReviewer(seen), () => sentence));
      expect(trail.guard.flagged).toBe(true);
      expect(trail.final.by).toBe('reviewer');
      // The suggestion is the sentence model's answer after the same rules the gate's answer went through.
      const ruled = { category: sentence.category, priority: guard(certain(sentence.category), sentence.priority, trail.maskedText, 0).priority };
      expect(seen.map((input) => input.suggestion)).toEqual([ruled]);
      expect(trail.models).toEqual({ word, sentence: ruled });
      // The card reads the suggestion from the trail's answer; one that differs from the word model's has no
      // "sure" percent. (The rules can lift the sentence answer's priority back to the word model's.)
      expect([trail.category.label, trail.guard.priority]).toEqual([ruled.category, ruled.priority]);
      if (ruled.priority !== word.priority) {
        expect(trail.category.confidence).toBe(0);
        differed += 1;
      }
      checked += 1;
    }
    expect(checked).toBe(TICKETS);
    expect(differed).toBeGreaterThan(TICKETS / 2);
  });

  it('counts what the Part 1 measurement counts on the same tickets', () => {
    // A stand-in sentence model: the true label, so the two models disagree wherever the word model is wrong.
    const truth = new Map(TICKETS_LIST.map((ticket) => [ticket.id, ticket.label]));
    const suggest = (_maskedText: string, id: string): ModelAnswer => {
      const label = truth.get(id);
      return { category: label?.category ?? 'Other', priority: label?.priority ?? 'Low' };
    };
    const trails = TICKETS_LIST.map((ticket) => runTwoModels(ticket.text, ticket.id, deps(recordingReviewer([]), suggest)));
    const asPrediction = certain;
    const measured = measureTwoPredictors(
      TICKETS_LIST.map((ticket) => ({ id: ticket.id, text: ticket.text, label: ticket.label })),
      (head, maskedText) => score(MODEL, head, maskedText),
      (head, _maskedText, id) => asPrediction(head === 'category' ? suggest('', id).category : suggest('', id).priority),
    );
    expect(trails.filter((trail) => trail.guard.flagged).length).toBe(measured.both.flagged);
    expect(trails.filter((trail) => trail.guard.flagged).length).toBeGreaterThan(measured.today.flagged);
  });
});
