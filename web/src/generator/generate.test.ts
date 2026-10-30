import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from '../domain/labels';
import { labelTicket } from '../domain/labelRules';
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
import { POLITE_SECURITY_TEMPLATES, THREAT_PHRASES, TRAP_TEMPLATES, TRAP_WORDS, introduceTypos } from './hardCases';
import { TEMPLATES, type Template } from './templates';

const SHARE_TOLERANCE = 0.015;
const SAMPLE_SIZE = 20000;
const FORMAT_SAMPLE_SIZE = 5000;
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
  it('gives the same ticket for the same seed and index, and a different one for another seed', () => {
    expect(generateTicket(42, 7)).toEqual(generateTicket(42, 7));
    expect(generateTicket(42, 7)).not.toEqual(generateTicket(43, 7));
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
  it('matches the pinned ticket for seed 42, index 0', () => {
    const ticket = generateTicket(42, 0);
    expect({ text: ticket.text, label: ticket.label }).toEqual({
      text: 'how do i change the email address on my account? i no longer use the old one. Please advise. Call me on 555-0163.',
      label: { category: 'Account Access', priority: 'High', mustReview: false },
    });
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

  it('produces all 9 categories and all 6 hard cases', () => {
    const labelled = new Set(TICKETS.map((ticket) => ticket.label.category));
    expect([...labelled].sort()).toEqual([...CATEGORIES].sort());
    const hard = new Set(TICKETS.map((ticket) => ticket.hardCase).filter((hardCase) => hardCase !== undefined));
    expect([...hard].sort()).toEqual([...HARD_CASES].sort());
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
    const severeWording = /can't work|every time|blocking|charged again/i;
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
    expect(POLITE_SECURITY_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('changes the letters of a typos ticket while keeping its word count', () => {
    const original = 'Please refund the extra charge on my Pro plan because the invoice looks wrong.';
    const mangled = introduceTypos(createRng(3), original);
    expect(mangled).not.toBe(original);
    expect(mangled.split(' ')).toHaveLength(original.split(' ').length);
    expect(introduceTypos(createRng(3), original)).toBe(mangled);
  });
});

describe('fake personal data and text limits', () => {
  const sample = TICKETS.slice(0, FORMAT_SAMPLE_SIZE);

  it('keeps every ticket ASCII, 1 to 2000 characters and free of unfilled slots', () => {
    for (const ticket of sample) {
      expect(ticket.text, ticket.id).toMatch(/^[\x20-\x7e\n]+$/);
      expect(ticket.text.length, ticket.id).toBeGreaterThanOrEqual(1);
      expect(ticket.text.length, ticket.id).toBeLessThanOrEqual(2000);
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
