import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { v0Triage } from '../baseline/v0';
import { ROUTES, type Priority } from '../domain/labels';
import { loadModel, score } from '../model/scorer';
import { guard } from './guard';
import { runTicket, runTickets, type RunDeps } from './run';
import type { ReviewDecision, ReviewInput } from './types';

const MODEL = loadModel(
  JSON.parse(readFileSync(new URL('../model/model.json', import.meta.url), 'utf8')),
);

const CLOCK_STEP = 5;
// Above any probability, so every ticket counts as low confidence.
const FLOOR_EVERYTHING = 1;
const FLOOR_NOTHING = 0;

const PLAIN_QUESTION = 'What sizes does the standard desk lamp come in?';
// The model reads this as "Other" with Accessibility Support as the runner-up,
// and no rule matches it, so only its doubt flags it.
const TORN_TOWARD_RISK = 'The page layout is hard to read with my tools';
const PERSONAL_TICKET =
  'Someone hacked my account. Reach me at jordan@mail.example.net or (212) 555-0147. ' +
  'Order #48213 never arrived, and card 4111-1111-1111-1111 was used.';
// The priority head says Medium and the escalated-complaint rule raises it to High.
const RAISED_BY_RULE = 'The desk lamp I ordered is awful, please help';
// "refund" in the address would fire the billing dispute rule on the raw text only.
const EMAIL_WITH_RULE_WORD = `My contact is refund.team@mail.example.net. ${PLAIN_QUESTION}`;
const RAW_PERSONAL_VALUES = ['jordan@mail', '555-0147', '48213', '4111'];

// Differs from the model's answer on PERSONAL_TICKET (Security Concern, Urgent, Security Team)
// in category, priority and route, so a final taken from the model instead of the reviewer shows.
const DECISION: ReviewDecision = {
  category: 'Urgent Complaint',
  priority: 'High',
  route: ROUTES['Urgent Complaint'],
  reason: 'The model said Security Concern; the reviewer read the ticket as an escalated complaint.',
};

function stubReviewer() {
  const inputs: ReviewInput[] = [];
  return {
    inputs,
    decide(input: ReviewInput): ReviewDecision {
      inputs.push(input);
      return DECISION;
    },
  };
}

function steppingClock(): () => number {
  let tick = 0;
  return () => {
    tick += CLOCK_STEP;
    return tick;
  };
}

function depsWith(overrides: Partial<RunDeps> & { reviewer: RunDeps['reviewer'] }): RunDeps {
  return {
    model: MODEL,
    floor: FLOOR_NOTHING,
    secondCheckOn: false,
    now: steppingClock(),
    ...overrides,
  };
}

describe('runTicket privacy', () => {
  it('keeps every personal value out of the trail and out of what the reviewer is shown', () => {
    const reviewer = stubReviewer();
    const trail = runTicket(PERSONAL_TICKET, 'T-1', depsWith({ reviewer }));

    expect(trail.found).toEqual(['email', 'phone', 'order', 'card']);
    // Both heads must have scored the masked text: the raw text would not show in the trail
    // (a prediction holds only vocabulary words) but it would change the numbers.
    expect(trail.category).toEqual(score(MODEL, 'category', trail.maskedText));
    expect(trail.priority).toEqual(score(MODEL, 'priority', trail.maskedText));
    expect(score(MODEL, 'category', PERSONAL_TICKET)).not.toEqual(trail.category);
    expect(score(MODEL, 'priority', PERSONAL_TICKET)).not.toEqual(trail.priority);
    const everything = JSON.stringify(trail);
    expect(everything).not.toContain(PERSONAL_TICKET);
    for (const value of RAW_PERSONAL_VALUES) {
      expect(everything).not.toContain(value);
    }

    expect(trail.guard.flagged).toBe(true);
    expect(reviewer.inputs).toHaveLength(1);
    const shown = JSON.stringify(reviewer.inputs);
    for (const value of RAW_PERSONAL_VALUES) {
      expect(shown).not.toContain(value);
    }
  });
});

describe('runTicket outcome', () => {
  it('finishes an unflagged ticket (floor 0, no rule hit, ordinary category) as the model said, without the reviewer', () => {
    const reviewer = stubReviewer();
    const trail = runTicket(PLAIN_QUESTION, 'T-2', depsWith({ reviewer }));

    expect(trail.guard.flagged).toBe(false);
    expect(reviewer.inputs).toEqual([]);
    expect(trail.review).toBeUndefined();
    expect(trail.final).toEqual({
      category: trail.category.label,
      priority: trail.guard.priority,
      route: ROUTES[trail.category.label as keyof typeof ROUTES],
      by: 'model',
    });
    expect(trail.final.category).toBe('Product Question');
    expect(trail.final.route).toBe('Product Specialists');
  });

  it('hands a flagged ticket to the reviewer with the model suggestion and uses its decision', () => {
    const reviewer = stubReviewer();
    const trail = runTicket(PERSONAL_TICKET, 'T-3', depsWith({ reviewer }));

    // The decision must differ from what the model and guard gave, or this test could not tell them apart.
    expect(trail.category.label).not.toBe(DECISION.category);
    expect(trail.guard.priority).not.toBe(DECISION.priority);
    expect(ROUTES[trail.category.label as keyof typeof ROUTES]).not.toBe(DECISION.route);
    expect(reviewer.inputs).toEqual([
      {
        id: 'T-3',
        maskedText: trail.maskedText,
        suggestion: { category: trail.category.label, priority: trail.guard.priority },
        reasons: trail.guard.reasons,
      },
    ]);
    expect(trail.review).toEqual(DECISION);
    expect(trail.final).toEqual({
      category: DECISION.category,
      priority: DECISION.priority,
      route: DECISION.route,
      by: 'reviewer',
    });
  });

  it('shows the reviewer the priority after the rules, not the priority head alone', () => {
    const reviewer = stubReviewer();
    const trail = runTicket(RAISED_BY_RULE, 'T-3b', depsWith({ reviewer }));

    // The priority head says Medium; the escalated-complaint rule raises it to High.
    expect(trail.priority.label).toBe('Medium');
    expect(trail.guard.priority).toBe('High');
    expect(reviewer.inputs).toHaveLength(1);
    expect(reviewer.inputs[0]?.suggestion.priority).toBe('High');
  });

  it('refuses empty text with the static code and never calls the reviewer', () => {
    const reviewer = stubReviewer();
    expect(() => runTicket('   ', 'T-4', depsWith({ reviewer }))).toThrow('E_EMPTY_TICKET');
    expect(reviewer.inputs).toEqual([]);
  });

  it('records the intake time and the clock difference as the time taken', () => {
    const ticks = [1000, 1042];
    let call = 0;
    const now = () => ticks[call++] ?? 0;
    const trail = runTicket(PLAIN_QUESTION, 'T-5', depsWith({ reviewer: stubReviewer(), now }));
    expect(trail.receivedAt).toBe(1000);
    expect(trail.ms).toBe(42);
    expect(call).toBe(2);
  });

  it('reads the rules from the masked text: a rule word inside an email address fires nothing', () => {
    const trail = runTicket(EMAIL_WITH_RULE_WORD, 'T-5b', depsWith({ reviewer: stubReviewer() }));

    expect(trail.guard.reasons.map((reason) => reason.kind === 'rule' && reason.reason)).not.toContain(
      'billing dispute',
    );
    // The raw text would add a billing dispute flag; the masked text adds none.
    expect(trail.guard).toEqual(
      guard(trail.category, trail.priority.label as Priority, trail.maskedText, FLOOR_NOTHING),
    );
    expect(trail.guard).not.toEqual(
      guard(trail.category, trail.priority.label as Priority, EMAIL_WITH_RULE_WORD, FLOOR_NOTHING),
    );
  });

  it('gives v0 the raw text, because v0 read it raw on the original page', () => {
    const text = EMAIL_WITH_RULE_WORD;
    const trail = runTicket(text, 'T-6', depsWith({ reviewer: stubReviewer() }));
    expect(trail.v0).toEqual({ category: 'Billing', priority: 'Medium', mustReview: true });
    // The same ticket as masked text would have given v0 a different answer.
    expect(v0Triage(trail.maskedText).category).toBe('Other');
  });
});

describe('runTicket second check', () => {
  const everythingLow = (secondCheckOn: boolean, reviewer = stubReviewer()) =>
    depsWith({ reviewer, floor: FLOOR_EVERYTHING, secondCheckOn });

  it('clears an ordinary doubtful ticket only when the check is on', () => {
    const off = runTicket(PLAIN_QUESTION, 'T-7', everythingLow(false));
    expect(off.guard.flagged).toBe(true);
    expect(off.final.by).toBe('reviewer');

    const reviewer = stubReviewer();
    const on = runTicket(PLAIN_QUESTION, 'T-7', everythingLow(true, reviewer));
    expect(on.guard.clearedBySecondCheck).toBe(true);
    expect(on.final.by).toBe('model');
    expect(reviewer.inputs).toEqual([]);
  });

  it('keeps a ticket whose category runner-up is a risky one, and any rule hit, flagged', () => {
    const reviewer = stubReviewer();
    const torn = runTicket(TORN_TOWARD_RISK, 'T-8', everythingLow(true, reviewer));
    expect(torn.guard.reasons.map((reason) => reason.kind)).toEqual(['low confidence']);
    expect(torn.guard.clearedBySecondCheck).toBe(false);
    expect(torn.final.by).toBe('reviewer');

    const ruled = runTicket('I want a refund for last month', 'T-9', everythingLow(true, reviewer));
    expect(ruled.guard.reasons.map((reason) => reason.kind)).toContain('rule');
    expect(ruled.guard.clearedBySecondCheck).toBe(false);
    expect(ruled.final.by).toBe('reviewer');
    expect(reviewer.inputs.map((input) => input.id)).toEqual(['T-8', 'T-9']);
  });
});

describe('runTickets', () => {
  it('returns one trail per ticket, in the order given', () => {
    const trails = runTickets(
      [
        { id: 'A', text: PLAIN_QUESTION },
        { id: 'B', text: PERSONAL_TICKET },
      ],
      depsWith({ reviewer: stubReviewer() }),
    );
    expect(trails.map((trail) => trail.id)).toEqual(['A', 'B']);
    expect(trails.map((trail) => trail.final.by)).toEqual(['model', 'reviewer']);
  });
});
