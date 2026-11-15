import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTES, type Category, type Priority } from '../domain/labels';
import { DESK_WORDING } from '../generator/deskFrames';
import { generateTickets } from '../generator/generate';
import { loadModel } from '../model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer, ReviewInput, TicketTrail } from '../pipeline/types';
import { routeTicket } from './splitFlow';
import type { ModelAnswer } from './twoModels';

// The desk's three paths: an operator card only when the two models disagree on where a ticket goes or how urgent
// it is (or the only flag says the ticket is too vague to place); otherwise straight to the agreed team, marked as
// needing a person when a word rule, a checked department or the word model's doubt flags it.

const MODEL = loadModel(JSON.parse(readFileSync(new URL('../model/model.json', import.meta.url), 'utf8')));
const TICKETS = generateTickets(21, 400, 'all', DESK_WORDING);
const HIGH: readonly Priority[] = ['High', 'Urgent'];
const OTHER_PRIORITY: Record<Priority, Priority> = { Low: 'Medium', Medium: 'Low', High: 'Urgent', Urgent: 'High' };

const PASS: Reviewer = { decide: (input) => ({ ...input.suggestion, route: ROUTES[input.suggestion.category] }) };

function recording(seen: ReviewInput[]): Reviewer {
  return { decide: (input) => (seen.push(input), { ...input.suggestion, route: 'reviewed' }) };
}

const settings = { model: MODEL, floor: CONFIDENCE_FLOOR, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };

// The word model's trail with every flag kept, and its answer after the rules.
function gateOf(text: string, id: string): { trail: TicketTrail; answer: ModelAnswer } {
  const trail = runTicket(text, id, { ...settings, reviewer: PASS });
  return { trail, answer: { category: trail.category.label as Category, priority: trail.guard.priority } };
}

function route(text: string, id: string, sentence: ModelAnswer, seen: ReviewInput[] = []): TicketTrail {
  return routeTicket(text, id, { ...settings, reviewer: recording(seen), suggest: () => sentence });
}

const kinds = (trail: TicketTrail) => new Set(trail.guard.reasons.map((reason) => reason.kind));
const rules = (trail: TicketTrail) => trail.guard.reasons.flatMap((reason) => (reason.kind === 'rule' ? [reason.reason] : []));
const vagueOnly = (trail: TicketTrail) => rules(trail).length > 0 && rules(trail).every((name) => name === 'vague ticket') && !kinds(trail).has('category');
const riskFlag = (trail: TicketTrail) => rules(trail).some((name) => name !== 'vague ticket') || kinds(trail).has('category');

const GATES = TICKETS.map((ticket) => ({ ticket, ...gateOf(ticket.text, ticket.id) }));
const where = (keep: (trail: TicketTrail) => boolean) => {
  const found = GATES.filter(({ trail }) => keep(trail));
  expect(found.length).toBeGreaterThan(0);
  return found;
};

describe('routeTicket', () => {
  it('makes an operator card when the models disagree on the department, whatever the rules say', () => {
    for (const { ticket, answer } of GATES) {
      const other = answer.category === 'Billing' ? 'Other' : 'Billing';
      const seen: ReviewInput[] = [];
      const trail = route(ticket.text, ticket.id, { category: other, priority: answer.priority }, seen);
      expect(trail.path).toBe('triage');
      expect(seen).toHaveLength(1);
      expect(trail.final.by).toBe('reviewer');
    }
  });

  it('makes an operator card when the models agree on the department but not the priority', () => {
    let tried = 0;
    for (const { ticket, answer } of where((trail) => !trail.guard.flagged)) {
      const trail = route(ticket.text, ticket.id, { category: answer.category, priority: OTHER_PRIORITY[answer.priority] });
      // The rules may lift the sentence answer back to the word model's priority; then the models agree.
      if (trail.models?.sentence.priority === answer.priority) continue;
      tried += 1;
      expect(trail.path).toBe('triage');
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('makes an operator card when the only flag says the ticket is too vague to place', () => {
    for (const { ticket, answer } of where(vagueOnly)) {
      expect(route(ticket.text, ticket.id, answer).path).toBe('triage');
    }
  });

  it('sends an agreed ticket a risk flag catches straight to its team, marked, with no operator card', () => {
    for (const { ticket, answer } of where((trail) => riskFlag(trail) && !vagueOnly(trail))) {
      const seen: ReviewInput[] = [];
      const trail = route(ticket.text, ticket.id, answer, seen);
      expect(trail.path).toBe('marked');
      expect(trail.marked).toBe(true);
      expect(seen).toHaveLength(0);
      expect(trail.review).toBeUndefined();
      expect(trail.final.category).toBe(answer.category);
      expect(trail.final.route).toBe(ROUTES[answer.category]);
    }
  });

  it('marks an agreed ticket the word model is unsure of, though no rule fires', () => {
    for (const { ticket, answer } of where((trail) => trail.guard.reasons.every((reason) => reason.kind === 'low confidence') && trail.guard.flagged)) {
      const trail = route(ticket.text, ticket.id, answer);
      expect(trail.path).toBe('marked');
      expect(trail.marked).toBe(true);
    }
  });

  it('raises a marked Low or Medium ticket to High and keeps a marked Urgent ticket Urgent', () => {
    const marked = GATES.map(({ ticket, answer }) => ({ answer, trail: route(ticket.text, ticket.id, answer) })).filter(({ trail }) => trail.path === 'marked');
    const low = marked.filter(({ answer }) => !HIGH.includes(answer.priority));
    const urgent = marked.filter(({ answer }) => answer.priority === 'Urgent');
    expect(low.length).toBeGreaterThan(0);
    expect(urgent.length).toBeGreaterThan(0);
    for (const { trail } of low) expect(trail.final.priority).toBe('High');
    for (const { trail } of urgent) expect(trail.final.priority).toBe('Urgent');
  });

  it('sends an agreed ticket nothing flags straight to its team, unmarked, with the word model answer', () => {
    for (const { ticket, answer, trail: gate } of where((trail) => !trail.guard.flagged)) {
      const seen: ReviewInput[] = [];
      const trail = route(ticket.text, ticket.id, answer, seen);
      expect(trail.path).toBe('direct');
      expect(trail.marked).toBe(false);
      expect(seen).toHaveLength(0);
      expect(trail.final).toEqual(gate.final);
    }
  });

  // A risk detector takes the place of the word model's doubt in the mark; the word rules and checked departments stay.
  it('with a risk detector, marks what it says yes to, drops doubt alone, keeps rules, and marks when it fails', () => {
    const route2 = (text: string, id: string, answer: ModelAnswer, riskMark: (id: string) => boolean): TicketTrail =>
      routeTicket(text, id, { ...settings, reviewer: recording([]), suggest: () => answer, riskMark });
    const doubtOnly = where((trail) => trail.guard.flagged && trail.guard.reasons.every((reason) => reason.kind === 'low confidence'));
    for (const { ticket, answer } of doubtOnly) {
      const cleared = route2(ticket.text, ticket.id, answer, () => false);
      expect(cleared.path).toBe('direct');
      // Nobody reviewed it, so it must not be counted as reviewed.
      expect(cleared.review).toBeUndefined();
      expect(cleared.final.by).toBe('model');
      expect(route2(ticket.text, ticket.id, answer, () => true).path).toBe('marked');
      // A score lookup that finds nothing is no answer, so the ticket is marked, as when the detector throws.
      expect(route2(ticket.text, ticket.id, answer, () => undefined as unknown as boolean).path).toBe('marked');
    }
    for (const { ticket, answer } of where((trail) => !trail.guard.flagged)) {
      expect(route2(ticket.text, ticket.id, answer, () => true).path).toBe('marked');
      const failed = route2(ticket.text, ticket.id, answer, () => {
        throw new Error('E_DETECTOR');
      });
      expect(failed.path).toBe('marked');
    }
    for (const { ticket, answer } of where((trail) => riskFlag(trail) && !vagueOnly(trail))) {
      expect(route2(ticket.text, ticket.id, answer, () => false).path).toBe('marked');
    }
  });

  it('keeps the mark on a risky ticket the operator routes, and adds none for doubt alone', () => {
    const operatorRoutes = ({ ticket, answer }: (typeof GATES)[number]) => {
      const other = answer.category === 'Billing' ? 'Other' : 'Billing';
      return route(ticket.text, ticket.id, { category: other, priority: answer.priority });
    };
    // A rule and a checked department each mark on their own; the vague rule and the model's doubt never do.
    for (const gate of where((trail) => rules(trail).includes('threatening language'))) {
      const trail = operatorRoutes(gate);
      expect(trail.path).toBe('triage');
      expect(trail.marked).toBe(true);
    }
    for (const gate of where((trail) => kinds(trail).has('category') && rules(trail).length === 0)) {
      const trail = operatorRoutes(gate);
      expect(trail.path).toBe('triage');
      expect(trail.marked).toBe(true);
    }
    for (const gate of where(vagueOnly)) {
      const trail = operatorRoutes(gate);
      expect(trail.path).toBe('triage');
      expect(trail.marked).toBe(false);
    }
    for (const gate of where((trail) => trail.guard.reasons.length > 0 && [...kinds(trail)].every((kind) => kind === 'low confidence'))) {
      const trail = operatorRoutes(gate);
      expect(trail.path).toBe('triage');
      expect(trail.marked).toBe(false);
    }
  });
});
