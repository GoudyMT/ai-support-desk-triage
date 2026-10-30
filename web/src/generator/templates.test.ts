import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDatasets, exportTickets } from '../../scripts/exportDataset';
import { CATEGORIES, type Category } from '../domain/labels';
import { FAKE_SENTENCES, fillSlots } from './fakeData';
import { CATEGORY_TRIGGER_WORDS, generateTickets, type Ticket } from './generate';
import {
  POLITE_SECURITY_TEMPLATES,
  THREAT_PHRASES,
  TRAP_TEMPLATES,
  TRAP_WORDS,
  TWO_ISSUE_CONNECTORS,
  VAGUE_TEMPLATES,
} from './hardCases';
import { createRng } from './rng';
import { CLOSERS, OPENERS, REQUESTS, TEMPLATES } from './templates';

// The hand-written set is the model's honest exam. If the generator already says
// the same thing in the same words, a good score proves only that the model
// memorised the generator.
const HANDWRITTEN_URL = new URL('../../../ml/data/handwritten.jsonl', import.meta.url);
const RUN_LENGTH = 4;

// Lower case, split on anything that is not a letter or digit (so "two-factor"
// and "two factor" match), and a {slot} breaks a run because its words vary.
function wordRuns(text: string): string[][] {
  return text
    .toLowerCase()
    .split(/\{\w+\}/)
    .map((part) => part.split(/[^a-z0-9]+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0);
}

function grams(text: string): string[] {
  const found: string[] = [];
  for (const words of wordRuns(text)) {
    for (let start = 0; start + RUN_LENGTH <= words.length; start += 1) {
      found.push(words.slice(start, start + RUN_LENGTH).join(' '));
    }
  }
  return found;
}

// Every piece of wording the generator can put in a ticket, each entry its own
// text: a template, a threat, a connector, an opener, a closer, a request, a
// fake-data frame.
const GENERATOR_TEXTS: string[] = [
  ...CATEGORIES.flatMap((category) => TEMPLATES[category].map((template) => template.text)),
  ...CATEGORIES.flatMap((category) => TRAP_TEMPLATES[category].map((template) => template.text)),
  ...VAGUE_TEMPLATES.map((template) => template.text),
  ...POLITE_SECURITY_TEMPLATES.map((template) => template.text),
  ...THREAT_PHRASES,
  ...TWO_ISSUE_CONNECTORS,
  ...OPENERS,
  ...CLOSERS,
  ...REQUESTS,
  ...Object.values(FAKE_SENTENCES).flat(),
];

const ROWS = readFileSync(HANDWRITTEN_URL, 'utf8')
  .replace(/\r/g, '')
  .trimEnd()
  .split('\n')
  .map((line) => JSON.parse(line) as { id: string; text: string });

describe('generator wording against the hand-written set', () => {
  it('shares no run of 4 words between any hand-written row and any template text', () => {
    const owner = new Map<string, string>();
    for (const text of GENERATOR_TEXTS) {
      for (const gram of grams(text)) {
        if (!owner.has(gram)) {
          owner.set(gram, text);
        }
      }
    }
    const shared: string[] = [];
    for (const row of ROWS) {
      const hits = [...new Set(grams(row.text))].filter((gram) => owner.has(gram));
      if (hits.length > 0) {
        shared.push(`${row.id}: ${hits.map((gram) => `"${gram}" in "${owner.get(gram)}"`).join('; ')}`);
      }
    }
    expect(shared, shared.join('\n')).toEqual([]);
  });

  // A slot breaks a run in the template check, but a filled slot can complete one:
  // "Does the {plan} include" becomes "does the pro plan include", which is the
  // hand-written row word for word. The fake-data sentences are only visible here.
  // Checked on every exported file, the only tickets a model trains and is scored
  // on, and on the live mix (split 'all'), which joins every fold's wording in
  // one ticket.
  it('shares no run of 4 words between any hand-written row and any exported or live-mix ticket', () => {
    const rowOf = new Map<string, string>();
    for (const row of ROWS) {
      for (const gram of grams(row.text)) {
        rowOf.set(gram, row.id);
      }
    }
    const shared = new Map<string, string>();
    const exported = buildDatasets().flatMap(({ train, heldout }) => [...train, ...heldout]);
    for (const ticket of [...exported, ...generateTickets(1, 20000)]) {
      for (const gram of grams(ticket.text)) {
        const id = rowOf.get(gram);
        if (id !== undefined && !shared.has(gram)) {
          shared.set(gram, `${id}: "${gram}" in "${ticket.text}"`);
        }
      }
    }
    expect([...shared.values()], [...shared.values()].join('\n')).toEqual([]);
  });
});

// Two templates that share a short run of words ("is using my login") let a
// model learn the run instead of the meaning, and when the two sit in different
// folds the held-out one is no longer wording the model has never seen.
describe('distinct wording', () => {
  // No allow-list: stock phrases ("i would like to", "is there a way to") are
  // worded differently in each text, so no two texts share a run, whatever their category.
  it('shares no run of 4 words between any two generator texts', () => {
    const owners = new Map<string, Set<string>>();
    for (const text of GENERATOR_TEXTS) {
      for (const gram of new Set(grams(text))) {
        owners.set(gram, (owners.get(gram) ?? new Set<string>()).add(text));
      }
    }
    const shared = [...owners.entries()]
      .filter(([, texts]) => texts.size > 1)
      .map(([gram, texts]) => `"${gram}" in ${[...texts].map((text) => `"${text}"`).join(' and ')}`);
    // The message lists every pair, so a failure shows the wording to change, not a count.
    expect(shared, shared.join('\n')).toEqual([]);
  });
});

// If a polite phrase leaned toward one category, "would you mind" would itself
// mean Account Access and the model would learn manners, not meaning. Each
// phrase must follow the category mix of all tickets. Checked on the live mix
// (seed 1, the same 20,000 as generateTickets(1, 20000)) and on the training
// export of every fold, the tickets a model actually learns from.
describe('polite phrases', () => {
  const SAMPLE_SIZE = 20000;
  // A phrase may lean toward some categories no more than this far (total
  // variation distance, half the summed gap between two category mixes) from the
  // mix of all tickets. Above it, the phrase itself would tell the model the
  // category.
  const MAX_POLITE_LEAN = 0.2;
  const MIN_CARRIERS = 50;
  const MIN_CHECKED_PHRASES = 20;
  // Words that make a run of words polite. A run holding one of them, found in
  // the polite security templates, is checked like the shared openers, closers
  // and requests, so a courtesy phrase written only into those templates (they
  // reach nothing but Security tickets) fails here.
  const COURTESY_WORDS = new Set([
    'please', 'thank', 'thanks', 'sorry', 'kindly', 'grateful', 'hope', 'appreciate', 'polite', 'politely',
    'mind', 'moment', 'rush', 'helpful', 'bother', 'trouble', 'hello', 'dear', 'regards', 'cheers', 'could', 'would',
  ]);
  const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== '');

  function politePhrases(): string[] {
    const phrases = new Set<string>([...OPENERS, ...CLOSERS, ...REQUESTS].map((text) => wordsOf(text).join(' ')));
    for (const { text } of POLITE_SECURITY_TEMPLATES) {
      const words = wordsOf(text);
      for (let length = 2; length <= RUN_LENGTH; length += 1) {
        for (let start = 0; start + length <= words.length; start += 1) {
          const run = words.slice(start, start + length);
          if (run.some((word) => COURTESY_WORDS.has(word))) {
            phrases.add(run.join(' '));
          }
        }
      }
    }
    return [...phrases];
  }

  function worstLean(tickets: Ticket[]): { lean: number; phrase: string; carriers: number; checked: number } {
    const mix = (rows: Ticket[]): Map<Category, number> =>
      new Map(CATEGORIES.map((category) => [category, rows.filter((row) => row.label.category === category).length / rows.length]));
    const overall = mix(tickets);
    const padded = tickets.map((ticket) => ` ${wordsOf(ticket.text).join(' ')} `);
    const worst = { lean: 0, phrase: '', carriers: 0, checked: 0 };
    for (const phrase of politePhrases()) {
      const carrying = tickets.filter((_ticket, index) => padded[index]?.includes(` ${phrase} `) === true);
      if (carrying.length < MIN_CARRIERS) {
        continue;
      }
      worst.checked += 1;
      const own = mix(carrying);
      const lean = CATEGORIES.reduce((sum, category) => sum + Math.abs((own.get(category) ?? 0) - (overall.get(category) ?? 0)), 0) / 2;
      if (lean > worst.lean) {
        Object.assign(worst, { lean, phrase, carriers: carrying.length });
      }
    }
    return worst;
  }

  const MIXES: [string, () => Ticket[]][] = [
    ['the live mix', () => generateTickets(1, SAMPLE_SIZE)],
    ...[0, 1, 2, 3].map((fold): [string, () => Ticket[]] => [
      `the fold ${fold} training export`,
      () => exportTickets(1, SAMPLE_SIZE, { fold, side: 'train' }),
    ]),
  ];

  it.each(MIXES)('stay close to the category mix of %s', (_name, tickets) => {
    const worst = worstLean(tickets());
    expect(worst.checked).toBeGreaterThanOrEqual(MIN_CHECKED_PHRASES);
    expect(worst.lean, `"${worst.phrase}" (${worst.carriers} tickets)`).toBeLessThanOrEqual(MAX_POLITE_LEAN);
  });
});

describe('crash templates', () => {
  // A crash that repeats stops the work; one that comes back after a restart does
  // not. The labeling rules call the first High and the second Medium, so the
  // model needs both to learn the difference.
  const crashing = TEMPLATES['Technical Issue'].filter((template) => /crash/i.test(template.text));

  it('has a severe crash and a non-severe crash for the model to tell apart', () => {
    expect(crashing.some((template) => template.severe === true)).toBe(true);
    expect(crashing.some((template) => template.severe !== true)).toBe(true);
  });
});

// The labeling rules applied to the wording: losing work is loss, a
// Security Concern reports an incident, and a question about plans and prices in
// general is a Product Question while one about the asker's own bill is Billing.
describe('label rulings applied to the templates', () => {
  const ALL_TECHNICAL = [...TEMPLATES['Technical Issue'], ...TRAP_TEMPLATES['Technical Issue']];

  it('marks every Technical template that loses the writer\'s work as severe', () => {
    const losingWork = ALL_TECHNICAL.filter((template) => /\blos(?:e|t|ing)\b[^.]*\b(?:typing|typed|work)\b/i.test(template.text));
    expect(losingWork.length).toBeGreaterThan(0);
    expect(losingWork.filter((template) => template.severe !== true).map((template) => template.text)).toEqual([]);
  });

  // "How do I see which devices are signed in?" is a how-to, so a model that
  // learns it as Security / Urgent sends every account-settings question to the
  // security team.
  it('gives Security Concern no how-to question, only reports of something that happened', () => {
    const howTo = /^(?:how (?:do|can|would) i|is there a way|where (?:do|can) i)\b/i;
    const security = [
      ...TEMPLATES['Security Concern'],
      ...TRAP_TEMPLATES['Security Concern'],
      ...POLITE_SECURITY_TEMPLATES,
    ];
    expect(security.filter((template) => howTo.test(template.text)).map((template) => template.text)).toEqual([]);
  });

  // Word lists, not a classifier: they catch a template that says "price" about
  // plans in general under Billing, or "my invoice" under Product Question.
  describe('price questions', () => {
    const PRICE_WORDS = /\b(?:price|prices|pricing|cost|costs|rate|rates)\b/i;
    // The asker's own bill: their invoice, receipt, statement, card, payment or
    // subscription, or a charge made to them.
    const OWN_BILL =
      /\b(?:my|our) (?:\w+ )?(?:invoices?|bills?|receipts?|statements?|cards?|payments?|subscriptions?)\b|\b(?:charged|billed) (?:me|us|again|twice)\b|\bI (?:paid|was charged|was billed)\b/i;
    const billing = [...TEMPLATES.Billing, ...TRAP_TEMPLATES.Billing];
    const product = [...TEMPLATES['Product Question'], ...TRAP_TEMPLATES['Product Question']];

    it('has Billing templates only where a mention of price is about the asker\'s own bill', () => {
      const priced = billing.filter((template) => PRICE_WORDS.test(template.text));
      expect(priced.length).toBeGreaterThan(0);
      expect(priced.filter((template) => !OWN_BILL.test(template.text)).map((template) => template.text)).toEqual([]);
    });

    it('has no Product Question template about the asker\'s own bill', () => {
      expect(product.filter((template) => OWN_BILL.test(template.text)).map((template) => template.text)).toEqual([]);
    });
  });
});

describe('fillSlots', () => {
  // A slot name comes from template text, but a plain-object lookup would also
  // answer to names every object inherits: {constructor} would fill in
  // "[object Object]" and {__proto__} would throw a raw TypeError.
  it.each(['constructor', '__proto__', 'toString'])('refuses the inherited name {%s} with E_UNKNOWN_SLOT', (name) => {
    expect(() => fillSlots(`Hello {${name}}`, createRng(1))).toThrow('E_UNKNOWN_SLOT');
  });

  it('refuses a name no slot defines', () => {
    expect(() => fillSlots('Hello {nothing}', createRng(1))).toThrow('E_UNKNOWN_SLOT');
  });
});

describe('product names', () => {
  // A product name that carried a category word would hand the model a free
  // clue, and one that carried a trap word would break the keyword-trap tickets.
  it('carry no category trigger word and no trap word', () => {
    const products = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      products.add(fillSlots('{product}', createRng(seed)));
    }
    expect(products.size).toBeGreaterThan(1);
    for (const product of products) {
      const lowered = product.toLowerCase();
      for (const word of [...CATEGORY_TRIGGER_WORDS, ...Object.keys(TRAP_WORDS)]) {
        expect(lowered.includes(word), `${product} contains "${word}"`).toBe(false);
      }
    }
  });
});
