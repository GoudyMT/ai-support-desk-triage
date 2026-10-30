import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../domain/labels';
import { CATEGORY_TRIGGER_WORDS, generateTickets } from './generate';
import {
  POLITE_SECURITY_TEMPLATES,
  THREAT_PHRASES,
  TRAP_TEMPLATES,
  TRAP_WORDS,
  TWO_ISSUE_CONNECTORS,
  VAGUE_TEMPLATES,
} from './hardCases';
import { createRng } from './rng';
import { CLOSERS, OPENERS, REQUESTS, TEMPLATES, fillSlots } from './templates';

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
    expect(shared).toEqual([]);
  });

  // A slot breaks a run in the template check, but a filled slot can complete one:
  // "Does the {plan} include" becomes "does the pro plan include", which is the
  // hand-written row word for word. The fake-data sentences are only visible here.
  it('shares no run of 4 words between any hand-written row and any generated ticket', () => {
    const rowOf = new Map<string, string>();
    for (const row of ROWS) {
      for (const gram of grams(row.text)) {
        rowOf.set(gram, row.id);
      }
    }
    const shared = new Map<string, string>();
    for (const ticket of [...generateTickets(1, 20000), ...generateTickets(2, 4000)]) {
      for (const gram of grams(ticket.text)) {
        const id = rowOf.get(gram);
        if (id !== undefined && !shared.has(gram)) {
          shared.set(gram, `${id}: "${gram}" in "${ticket.text}"`);
        }
      }
    }
    expect([...shared.values()]).toEqual([]);
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
