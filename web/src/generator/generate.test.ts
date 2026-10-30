import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from '../domain/labels';
import { labelTicket, primaryCategory } from '../domain/labelRules';
import { createRng } from './rng';
import {
  CATEGORY_SHARES,
  CATEGORY_TRIGGER_WORDS,
  FAKE_DATA_SHARE,
  HARD_CASE_SHARES,
  generateTicket,
  generateTicketDetail,
  generateTickets,
  type HardCase,
} from './generate';
import { THREAT_PHRASES, TRAP_TEMPLATES, TRAP_WORDS, introduceTypos } from './hardCases';
import { TEMPLATES, type Template } from './templates';

const SHARE_TOLERANCE = 0.015;
const SAMPLE_SIZE = 20000;
const FORMAT_SAMPLE_SIZE = 5000;
const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 2000;
const HARD_CASES = Object.keys(HARD_CASE_SHARES) as HardCase[];

// Built once: the share tests need 20,000 tickets and each build is the real path.
const DETAILS = Array.from({ length: SAMPLE_SIZE }, (_, index) => generateTicketDetail(1, index));
const TICKETS = DETAILS.map((detail) => detail.ticket);

// Written out here, not read from the generator's constants, so a changed share
// cannot move the expected answer with it.
const EXPECTED_CATEGORY_SHARES: Record<Category, number> = {
  'Technical Issue': 0.22,
  Billing: 0.18,
  'Account Access': 0.14,
  'Product Question': 0.12,
  'Shipping/Order Issue': 0.12,
  Other: 0.06,
  'Security Concern': 0.06,
  'Accessibility Support': 0.05,
  'Urgent Complaint': 0.05,
};
const EXPECTED_HARD_CASE_SHARES: Record<HardCase, number> = {
  vague: 0.06,
  threatening: 0.04,
  'two-issues': 0.08,
  typos: 0.1,
  'keyword-trap': 0.04,
  'polite-security': 0.04,
};
const EXPECTED_FAKE_DATA_SHARE = 0.15;

function shareOf(count: number): number {
  return count / SAMPLE_SIZE;
}

// The parts of a template's text that no slot can change.
function fixedWording(template: Template): string[] {
  return template.text
    .split(/\{\w+\}/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
}

function carriesWording(text: string, template: Template): boolean {
  const lowered = text.toLowerCase();
  return fixedWording(template).every((part) => lowered.includes(part));
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let position = 0; position < digits.length; position += 1) {
    let digit = Number(digits[digits.length - 1 - position]);
    if (position % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

describe('generateTicket', () => {
  it('gives the same ticket for the same seed and index', () => {
    expect(generateTicket(42, 7)).toEqual(generateTicket(42, 7));
  });

  // Whole tickets differ across seeds even when the generator ignores the seed
  // (the id and seed fields carry it), so only the texts show whether the seed
  // reaches the wording.
  it('writes different texts at every position for another seed', () => {
    const first = generateTickets(1, 50);
    const second = generateTickets(2, 50);
    first.forEach((ticket, index) => {
      expect(ticket.text, `position ${index}`).not.toBe(second[index]?.text);
    });
  });

  it('builds ticket i of generateTickets exactly as generateTicket(seed, i)', () => {
    const tickets = generateTickets(5, 4);
    expect(tickets).toHaveLength(4);
    tickets.forEach((ticket, index) => {
      expect(ticket).toEqual(generateTicket(5, index));
      expect(ticket.id).toBe(`T-5-${index}`);
    });
  });

  // Pins replay across machines: any change to a template, a share or the draw
  // order moves this ticket, and with it every saved run and dataset.
  // Index 1 is a plain polite request, 2 a repeated crash with typos (High) and
  // 6 a keyword trap: "Nevada" hides "ada" in a Billing ticket.
  it.each([
    {
      index: 0,
      text: 'Can several people edit the same report in Quillfold dashboard at once? Thank you so much.',
      label: { category: 'Product Question', priority: 'Low', mustReview: false },
    },
    {
      index: 1,
      text: 'Hey,\nWould you mind telling me how to change the email address on my account? I no longer use the old one.',
      label: { category: 'Account Access', priority: 'High', mustReview: false },
    },
    {
      index: 2,
      text: 'quillfold dashboard keeps crashing on my phone. it has happened every day this wee and my team is waiting on me.',
      label: { category: 'Technical Issue', priority: 'High', mustReview: false },
    },
    {
      index: 6,
      text: 'I was billed twice for the Harbor reports licence for our Nevada office. Please refund one of them. It was my card 4884 5463 9242 0830.',
      label: { category: 'Billing', priority: 'High', mustReview: true, reviewReason: 'billing dispute' },
    },
  ])('matches the pinned ticket for seed 42, index $index', ({ index, text, label }) => {
    const ticket = generateTicket(42, index);
    expect({ text: ticket.text, label: ticket.label }).toEqual({ text, label });
  });
});

// A seed or index outside the 32-bit range would wrap silently in the seed
// mixing and quietly repeat another ticket; a count nobody can build would hang
// the page. Both are refused up front.
describe('input guards', () => {
  const MAX_SEED = 0xffffffff;

  it.each([1.9, -1, 2 ** 32 + 1, Number.NaN])('refuses the seed %s with E_SEED_RANGE', (seed) => {
    expect(() => generateTicketDetail(seed, 0)).toThrow('E_SEED_RANGE');
  });

  it.each([-1, 1.5])('refuses the index %s with E_SEED_RANGE', (index) => {
    expect(() => generateTicketDetail(1, index)).toThrow('E_SEED_RANGE');
  });

  it('accepts the seeds at both ends of the range', () => {
    expect(generateTicket(0, 0).id).toBe('T-0-0');
    expect(generateTicket(MAX_SEED, 0).id).toBe(`T-${MAX_SEED}-0`);
  });

  it.each([-1, Number.NaN, 1.5, 100_001])('refuses the count %s with E_COUNT_RANGE', (count) => {
    expect(() => generateTickets(1, count)).toThrow('E_COUNT_RANGE');
  });

  it('returns no tickets for a count of 0, and builds the largest allowed count', () => {
    expect(generateTickets(1, 0)).toEqual([]);
    expect(generateTickets(1, 100_000)).toHaveLength(100_000);
  });
});

describe('shares over 20,000 tickets', () => {
  it('keeps every base category within 1.5 points of its target', () => {
    for (const category of CATEGORIES) {
      const count = DETAILS.filter((detail) => detail.baseCategory === category).length;
      expect(Math.abs(shareOf(count) - EXPECTED_CATEGORY_SHARES[category]), category).toBeLessThan(SHARE_TOLERANCE);
    }
    expect(CATEGORY_SHARES).toEqual(EXPECTED_CATEGORY_SHARES);
  });

  it('keeps every hard case within 1.5 points of its target', () => {
    for (const hardCase of HARD_CASES) {
      const count = TICKETS.filter((ticket) => ticket.hardCase === hardCase).length;
      expect(Math.abs(shareOf(count) - EXPECTED_HARD_CASE_SHARES[hardCase]), hardCase).toBeLessThan(SHARE_TOLERANCE);
    }
    expect(HARD_CASE_SHARES).toEqual(EXPECTED_HARD_CASE_SHARES);
  });

  it('keeps the fake-data share within 1.5 points of 0.15', () => {
    const count = TICKETS.filter((ticket) => ticket.hasFakeData).length;
    expect(FAKE_DATA_SHARE).toBe(EXPECTED_FAKE_DATA_SHARE);
    expect(Math.abs(shareOf(count) - EXPECTED_FAKE_DATA_SHARE)).toBeLessThan(SHARE_TOLERANCE);
  });
});

describe('labels', () => {
  it('gives every ticket the label labelTicket computes from the facts it was built with', () => {
    for (const { ticket, facts } of DETAILS) {
      expect(ticket.label, ticket.id).toEqual(labelTicket(facts));
    }
  });

  // A template whose facts disagree with its wording would label tickets
  // wrongly, and every accuracy number after it with them.
  it('sets billingDispute, severe and statusQuestion only where the template wording says so', () => {
    const disputeWording = /refund|twice|charged again|never signed up|second time/i;
    // A duplicate or repeat charge counts as "charged again", and a crash that
    // keeps happening stops the work.
    const severeWording = /can't work|every time|keeps crashing|blocking|charged again|twice|double charge/i;
    const statusWording = /where is my order|order status|any update/i;
    const all: [Category, Template][] = [];
    for (const category of CATEGORIES) {
      for (const template of [...TEMPLATES[category], ...TRAP_TEMPLATES[category]]) {
        all.push([category, template]);
      }
    }
    for (const [category, template] of all) {
      if (category === 'Billing') {
        expect(template.billingDispute === true, template.text).toBe(disputeWording.test(template.text));
      } else {
        expect(template.billingDispute, template.text).toBeUndefined();
      }
      if (category === 'Billing' || category === 'Technical Issue') {
        expect(template.severe === true, template.text).toBe(severeWording.test(template.text));
      } else {
        expect(template.severe, template.text).toBeUndefined();
      }
      if (category === 'Shipping/Order Issue') {
        expect(template.statusQuestion === true, template.text).toBe(statusWording.test(template.text));
      } else {
        expect(template.statusQuestion, template.text).toBeUndefined();
      }
    }
  });
});

describe('hard cases look like their case', () => {
  it('keeps every category trigger word out of vague tickets (whole words, any case)', () => {
    const vague = TICKETS.filter((ticket) => ticket.hardCase === 'vague');
    expect(vague.length).toBeGreaterThan(0);
    for (const ticket of vague) {
      for (const word of CATEGORY_TRIGGER_WORDS) {
        expect(containsWord(ticket.text, word), `${ticket.id} has "${word}": ${ticket.text}`).toBe(false);
      }
    }
  });

  it('labels every threatening ticket Urgent Complaint and puts a threat phrase in its text', () => {
    const threatening = TICKETS.filter((ticket) => ticket.hardCase === 'threatening');
    expect(threatening.length).toBeGreaterThan(0);
    for (const ticket of threatening) {
      expect(ticket.label.category, ticket.id).toBe('Urgent Complaint');
      const lowered = ticket.text.toLowerCase();
      expect(
        THREAT_PHRASES.some((phrase) => lowered.includes(phrase.toLowerCase())),
        ticket.text,
      ).toBe(true);
    }
  });

  // Substring match on purpose: v0 used text.includes(), so "Canada" fooled its
  // "ada" rule. A whole-word match here would miss the very bug being modelled.
  it('puts a trap word in every keyword-trap ticket whose true category is not the one the word suggests', () => {
    const traps = TICKETS.filter((ticket) => ticket.hardCase === 'keyword-trap');
    expect(traps.length).toBeGreaterThan(0);
    for (const ticket of traps) {
      const lowered = ticket.text.toLowerCase();
      const present = Object.keys(TRAP_WORDS).filter((word) => lowered.includes(word));
      expect(present.length, ticket.text).toBeGreaterThan(0);
      for (const word of present) {
        expect(ticket.label.category, `${ticket.id} "${word}"`).not.toBe(TRAP_WORDS[word]);
      }
    }
  });

  it('keeps hacked, unauthorized, breach and stolen out of polite security tickets, which stay Security Concern', () => {
    const polite = TICKETS.filter((ticket) => ticket.hardCase === 'polite-security');
    expect(polite.length).toBeGreaterThan(0);
    for (const ticket of polite) {
      expect(ticket.label.category, ticket.id).toBe('Security Concern');
      expect(ticket.text.toLowerCase(), ticket.id).not.toMatch(/hacked|unauthorized|breach|stolen/);
    }
  });

  it('changes the letters of a typos ticket while keeping its word count', () => {
    const original = 'Please refund the extra charge on my Pro plan because the invoice looks wrong.';
    const mangled = introduceTypos(createRng(3), original);
    expect(mangled).not.toBe(original);
    expect(mangled.split(' ')).toHaveLength(original.split(' ').length);
    expect(introduceTypos(createRng(3), original)).toBe(mangled);
  });
});

// The label is only as true as the facts, and the facts only as true as the
// text. These tie each hard case's label to the template wording it was built
// from, through generateTicketDetail, the same path generateTicket uses.
describe('hard-case labels follow their text', () => {
  it('labels every vague ticket Other, Medium, must-review for a vague ticket', () => {
    const vague = DETAILS.filter((detail) => detail.ticket.hardCase === 'vague');
    expect(vague.length).toBeGreaterThan(0);
    for (const { ticket } of vague) {
      expect(ticket.label, ticket.id).toEqual({
        category: 'Other',
        priority: 'Medium',
        mustReview: true,
        reviewReason: 'vague ticket',
      });
    }
  });

  it('builds every two-issue ticket from two distinct issues, both texts, and the flags the rule gives', () => {
    const twoIssues = DETAILS.filter((detail) => detail.ticket.hardCase === 'two-issues');
    expect(twoIssues.length).toBeGreaterThan(0);
    for (const { ticket, facts, templates } of twoIssues) {
      const [first, other] = templates;
      if (first === undefined || other === undefined) {
        throw new Error('E_TEST_TEMPLATES');
      }
      expect(templates, ticket.id).toHaveLength(2);
      expect(new Set(facts.issues).size, ticket.id).toBe(2);
      expect(ticket.label.secondary, ticket.id).toBeDefined();
      expect(ticket.label.secondary, ticket.id).not.toBe(ticket.label.category);
      expect(carriesWording(ticket.text, first), ticket.text).toBe(true);
      expect(carriesWording(ticket.text, other), ticket.text).toBe(true);
      // Dispute and status come from the issue that decides the category;
      // words of loss or blocking count from either.
      const deciding = primaryCategory(facts.issues) === facts.issues[0] ? first : other;
      expect(facts.billingDispute, ticket.id).toBe(deciding.billingDispute === true);
      expect(facts.statusQuestion, ticket.id).toBe(deciding.statusQuestion === true);
      expect(facts.severe, ticket.id).toBe(first.severe === true || other.severe === true);
    }
  });

  // A Billing ticket that also says "This is blocking my whole team" about a
  // sync problem is High: the blocking words are in the ticket either way.
  it('raises a Billing ticket to High when the losing Technical issue is severe', () => {
    const rows = DETAILS.filter(({ ticket, facts, templates }) => {
      const billing = templates[facts.issues.indexOf('Billing')];
      const technical = templates[facts.issues.indexOf('Technical Issue')];
      return (
        ticket.hardCase === 'two-issues' &&
        billing !== undefined &&
        technical !== undefined &&
        billing.severe !== true &&
        technical.severe === true
      );
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const { ticket } of rows) {
      expect(ticket.label.category, ticket.id).toBe('Billing');
      expect(ticket.label.priority, ticket.id).toBe('High');
    }
  });

  it('applies typos to the text of typos tickets and to no others', () => {
    let typos = 0;
    for (const { ticket, templates, plainText } of DETAILS) {
      if (ticket.hardCase === 'typos') {
        typos += 1;
        const [template] = templates;
        expect(template, ticket.id).toBeDefined();
        expect(carriesWording(plainText, template as Template), plainText).toBe(true);
        expect(ticket.text.startsWith(plainText), ticket.text).toBe(false);
      } else {
        expect(ticket.text.startsWith(plainText), ticket.text).toBe(true);
      }
    }
    expect(typos).toBeGreaterThan(0);
  });
});

describe('generated wording reads like one customer wrote it', () => {
  it('never names the same plan twice in one sentence', () => {
    for (const ticket of TICKETS) {
      for (const sentence of ticket.text.split(/[.?!]/)) {
        const plans = (sentence.match(/\b(?:pro|team|starter|business) plan\b/gi) ?? []).map((plan) => plan.toLowerCase());
        expect(new Set(plans).size, ticket.text).toBe(plans.length);
      }
    }
  });

  it('never repeats a word back to back, as in "workspace workspace"', () => {
    for (const ticket of TICKETS) {
      expect(ticket.text, ticket.id).not.toMatch(/\b(\w+)\s+\1\b/i);
    }
  });

  it('puts threats only after a grievance, never "Not urgent, just curious ... you will regret it"', () => {
    const threatening = DETAILS.filter((detail) => detail.ticket.hardCase === 'threatening');
    expect(threatening.length).toBeGreaterThan(0);
    for (const { ticket, templates } of threatening) {
      expect(templates[0]?.grievance, ticket.id).toBe(true);
      expect(ticket.text.toLowerCase(), ticket.id).not.toContain('not urgent');
    }
  });

  // If polite wording came only with polite-security tickets, "could you please"
  // would itself mean Security Concern and the model would learn manners, not
  // meaning. Tickets 0-4999 of seed 1 are the same as generateTickets(1, 5000).
  it('spreads every polite phrase over at least 3 label categories', () => {
    const phrases = ['could you please', 'thank you so much', 'many thanks', 'good afternoon', 'dear support', 'would you mind', 'hello team'];
    const sample = TICKETS.slice(0, FORMAT_SAMPLE_SIZE);
    for (const phrase of phrases) {
      const categories = new Set(sample.filter((ticket) => ticket.text.toLowerCase().includes(phrase)).map((ticket) => ticket.label.category));
      expect(categories.size, `${phrase}: ${[...categories].join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('opens with at most one greeting and closes with at most one thanks', () => {
    const greeting = /\b(?:hi there|hi|hello|hey|good morning|good afternoon|dear|to whom it may concern)\b/gi;
    const signOff = /\b(?:thanks|thank you|cheers|regards|please advise|appreciate any help)\b/gi;
    for (const ticket of TICKETS) {
      expect((ticket.text.match(greeting) ?? []).length, ticket.text).toBeLessThanOrEqual(1);
      expect((ticket.text.match(signOff) ?? []).length, ticket.text).toBeLessThanOrEqual(1);
    }
  });
});

describe('fake personal data and text limits', () => {
  const sample = TICKETS.slice(0, FORMAT_SAMPLE_SIZE);

  it('keeps every ticket ASCII, 1 to 2000 characters and free of unfilled slots', () => {
    for (const ticket of sample) {
      expect(ticket.text, ticket.id).toMatch(/^[\x20-\x7e\n]+$/);
      expect(ticket.text.length, ticket.id).toBeGreaterThanOrEqual(MIN_TEXT_LENGTH);
      expect(ticket.text.length, ticket.id).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
      expect(ticket.text, ticket.id).not.toMatch(/[{}]/);
    }
  });

  it('uses only example.com and example.org emails', () => {
    let found = 0;
    for (const ticket of sample) {
      for (const email of ticket.text.match(/[\w.+-]*@[\w-]+(?:\.[\w-]+)*/g) ?? []) {
        found += 1;
        expect(email, ticket.id).toMatch(/^[a-z0-9.]+@example\.(com|org)$/);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('uses only phone numbers 555-0100 to 555-0199', () => {
    let found = 0;
    for (const ticket of sample) {
      for (const phone of ticket.text.match(/\b\d{3}-\d{4}\b/g) ?? []) {
        found += 1;
        expect(phone, ticket.id).toMatch(/^555-01\d\d$/);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('makes every 13 to 19 digit run fail the Luhn check', () => {
    let runs = 0;
    for (const ticket of sample) {
      for (const run of ticket.text.match(/\d(?:[ -]?\d){12,18}/g) ?? []) {
        runs += 1;
        expect(luhnValid(run.replace(/\D/g, '')), `${ticket.id} ${run}`).toBe(false);
      }
    }
    expect(runs).toBeGreaterThan(0);
  });

  it('flags hasFakeData exactly when the text carries an email, phone, card or order number', () => {
    const fakePattern = /@example\.|\b555-01\d\d\b|\d{4} \d{4} \d{4} \d{4}|\bORD-\d{6}\b/;
    for (const ticket of sample) {
      expect(ticket.hasFakeData, ticket.text).toBe(fakePattern.test(ticket.text));
    }
  });
});
