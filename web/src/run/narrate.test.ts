import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REVIEW_RULES } from '../pipeline/rules';
import { loadModel } from '../model/scorer';
import { CONFIDENCE_FLOOR, runTicket } from '../pipeline/run';
import type { FlagReason, ReviewDecision, TicketTrail } from '../pipeline/types';
import { narrate } from './narrate';
import { STAGES } from './stage';

const MODEL = loadModel(
  JSON.parse(readFileSync(new URL('../../public/models/fold_0.json', import.meta.url), 'utf8')),
);

const MAX_PLAIN_WORDS = 40;
const MAX_SENTENCES = 2;

const DECISION: ReviewDecision = {
  category: 'Urgent Complaint',
  priority: 'High',
  route: 'Escalations',
  reason: 'The reviewer read the ticket as an escalated complaint.',
};

function trailFor(text: string): TicketTrail {
  return runTicket(text, 'T-1', {
    model: MODEL,
    reviewer: { decide: () => DECISION },
    floor: CONFIDENCE_FLOOR,
    secondCheckOn: false,
    now: () => 1,
  });
}

// Fold 0 reads each of these as noted; the checks below assert the part they rely on.
const CALM = trailFor('My package has not arrived and the tracking page shows no update for a week.');
const ACCESSIBILITY = trailFor(
  'The video has no captions, so I cannot follow along with my screen reader.',
);
const PERSONAL = trailFor(
  'Someone hacked my account. Reach me at jordan@mail.example.net or (212) 555-0147. ' +
    'Order #48213 never arrived, and card 4111-1111-1111-1111 was used.',
);
const BILLING = trailFor('Please refund the duplicate charge on my invoice, the amount is wrong.');
const DOUBTFUL = trailFor('I forgot my password and the reset email never arrives, so I cannot log in.');
const ALL_TRAILS = [CALM, ACCESSIBILITY, PERSONAL, BILLING, DOUBTFUL];

// Every reason the guardrails can give at once, each rule with several words.
const EVERYTHING_FLAGGED: TicketTrail = {
  ...PERSONAL,
  guard: {
    ...PERSONAL.guard,
    reasons: [
      ...(Object.keys(REVIEW_RULES) as (keyof typeof REVIEW_RULES)[]).map(
        (reason): FlagReason => ({ kind: 'rule', reason, words: ['alpha', 'bravo', 'charlie'] }),
      ),
      { kind: 'category', category: 'Security Concern' },
      { kind: 'low confidence', confidence: 0.42 },
    ],
  },
};

function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function detailText(trail: TicketTrail): string {
  return narrate(trail, 'guardrails')
    .detail.map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}

describe('fixtures', () => {
  it('are the tickets the checks below say they are', () => {
    expect(CALM.guard.flagged).toBe(false);
    expect(ACCESSIBILITY.guard.reasons.map((r) => r.kind)).toEqual(['rule', 'category']);
    expect(PERSONAL.guard.reasons.map((r) => r.kind)).toEqual(['rule', 'category', 'low confidence']);
    expect(PERSONAL.found).toEqual(['email', 'phone', 'order', 'card']);
    expect(BILLING.guard.reasons.map((r) => r.kind)).toEqual(['rule']);
    expect(DOUBTFUL.guard.reasons.map((r) => r.kind)).toEqual(['low confidence']);
  });
});

describe('narrate: every stage reads as a short plain note', () => {
  const cases = STAGES.flatMap((stage) =>
    [...ALL_TRAILS, EVERYTHING_FLAGGED].map((trail, i) => ({ stage, trail, i })),
  );

  it.each(cases)('stage $stage, ticket $i: one or two sentences, under 40 words', ({ stage, trail }) => {
    const { plain } = narrate(trail, stage);
    expect(sentenceCount(plain), plain).toBeGreaterThanOrEqual(1);
    expect(sentenceCount(plain), plain).toBeLessThanOrEqual(MAX_SENTENCES);
    expect(wordCount(plain), plain).toBeLessThan(MAX_PLAIN_WORDS);
  });

  it.each(cases)('stage $stage, ticket $i: never calls anything "AI"', ({ stage, trail }) => {
    const { plain, detail } = narrate(trail, stage);
    const all = [plain, ...detail.flatMap((row) => [row.label, row.value])].join('\n');
    expect(all).not.toMatch(/\bAI\b/);
  });
});

describe('narrate: privacy', () => {
  it('says what was masked, in the wording of the trail line', () => {
    expect(narrate({ ...CALM, found: ['phone'] }, 'privacy').plain).toBe(
      'Privacy: masked 1 phone number.',
    );
  });

  it('counts each kind and pluralises it', () => {
    const { plain } = narrate({ ...CALM, found: ['phone', 'email', 'phone'] }, 'privacy');
    expect(plain).toContain('2 phone numbers');
    expect(plain).toContain('1 email address');
  });

  it('says plainly when nothing personal was found', () => {
    expect(narrate(CALM, 'privacy').plain).toMatch(/nothing/i);
  });
});

describe('narrate: classify', () => {
  it('names the model, its pick, how sure it is and the word it leaned on most', () => {
    const { plain } = narrate(ACCESSIBILITY, 'classify');
    expect(plain).toContain('model');
    expect(plain).toContain('Accessibility Support');
    expect(plain).toContain('95%');
    expect(plain).toContain('"cannot"');
  });
});

describe('narrate: guardrails', () => {
  it('speaks the first reasons as a whole sentence and leaves the rest to the detail', () => {
    const { plain, detail } = narrate(EVERYTHING_FLAGGED, 'guardrails');
    expect(plain).toMatch(/"[^"]+".$|floor.$|person.$/);
    expect(plain).not.toContain('more');
    expect(detail.filter((row) => row.label.startsWith('Flag'))).toHaveLength(EVERYTHING_FLAGGED.guard.reasons.length);
  });

  it('names the reason a rule fired, the word it saw and the category check', () => {
    const { plain } = narrate(ACCESSIBILITY, 'guardrails');
    expect(plain).toContain('accessibility issue');
    expect(plain).toContain('"screen reader"');
    expect(plain).toContain('Accessibility Support');
    expect(plain).toMatch(/waits for a person/);
  });

  it('names a rule that fired alone', () => {
    const { plain } = narrate(BILLING, 'guardrails');
    expect(plain).toContain('billing dispute');
    expect(plain).toContain('"charge on my"');
  });

  it('says the model was unsure when doubt alone flagged it, with the floor', () => {
    const { plain } = narrate(DOUBTFUL, 'guardrails');
    expect(plain).toContain('40%');
    expect(plain).toContain('50%');
    expect(plain).toMatch(/waits for a person/);
  });

  it('says a confident, rule-free ticket goes straight through, and why', () => {
    const { plain } = narrate(CALM, 'guardrails');
    expect(plain).toContain('54%');
    expect(plain).toMatch(/no safety rule/);
    expect(plain).toMatch(/straight through/);
    expect(plain).not.toMatch(/waits for a person/);
  });

  it('says a second check cleared the doubt, not that the model was sure', () => {
    const cleared: TicketTrail = {
      ...DOUBTFUL,
      guard: { ...DOUBTFUL.guard, flagged: false, reasons: [], clearedBySecondCheck: true },
    };
    const { plain } = narrate(cleared, 'guardrails');
    expect(plain).toMatch(/second check/);
    expect(plain).toMatch(/straight through/);
    expect(plain).not.toContain('sure');
  });
});

describe('narrate: review and done', () => {
  it('says no person looked when nothing was flagged', () => {
    expect(narrate(CALM, 'review').plain).toMatch(/no review|nobody|no one/i);
  });

  it('names the simulated reviewer and its choice when a ticket was flagged', () => {
    const { plain } = narrate(ACCESSIBILITY, 'review');
    expect(plain).toContain('simulated reviewer');
    expect(plain).toContain('Urgent Complaint');
  });

  it('says where it went and who decided', () => {
    const calm = narrate(CALM, 'done').plain;
    expect(calm).toContain('Fulfillment Team');
    expect(calm).toContain('the model');
    const flagged = narrate(ACCESSIBILITY, 'done').plain;
    expect(flagged).toContain('Escalations');
    expect(flagged).toContain('the reviewer');
  });
});

describe('narrate: technical detail', () => {
  it('gives the confidence of the category pick and the 0.50 floor', () => {
    const rows = narrate(ACCESSIBILITY, 'classify').detail;
    expect(rows.find((row) => row.label === 'Confidence')?.value).toBe('0.95 for Accessibility Support');
    expect(rows.find((row) => row.label === 'Confidence floor')?.value).toBe('0.50');
  });

  it('lists every reason that fired, with its rule words, in every stage', () => {
    for (const stage of STAGES) {
      const text = narrate(PERSONAL, stage)
        .detail.map((row) => `${row.label}: ${row.value}`)
        .join('\n');
      expect(text).toContain('security incident');
      expect(text).toContain('hacked');
      expect(text).toContain('Security Concern');
      expect(text).toContain('0.43');
    }
  });

  it('lists all the words of a rule, including ones not written in the text', () => {
    const text = detailText(ACCESSIBILITY);
    expect(text).toContain('screen reader');
    expect(text).toContain('captions');
    const everything = detailText(EVERYTHING_FLAGGED);
    for (const reason of Object.keys(REVIEW_RULES)) {
      expect(everything).toContain(reason);
    }
    expect(everything).toContain('charlie');
    expect(everything).toContain('Flag: low confidence: 0.42 is below the 0.50 floor');
  });

  it('says there were no flags when none fired', () => {
    const rows = narrate(CALM, 'guardrails').detail;
    expect(rows.find((row) => row.label === 'Flags')?.value).toBe('none');
  });

  it('lists the top words with their weights', () => {
    const text = detailText(ACCESSIBILITY);
    for (const { term, weight } of ACCESSIBILITY.category.topTerms) {
      expect(text).toContain(`"${term}"`);
      expect(text).toContain(weight.toFixed(2));
    }
  });

  it('lists what was masked, and says so when nothing was', () => {
    const text = detailText(PERSONAL);
    for (const kind of ['email address', 'phone number', 'order number', 'card number']) {
      expect(text).toContain(kind);
    }
    expect(narrate(CALM, 'privacy').detail.find((row) => row.label === 'Masked')?.value).toBe('nothing');
  });
});
