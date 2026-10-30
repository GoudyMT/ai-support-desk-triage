import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDatasets } from '../../scripts/exportDataset';
import { CATEGORIES } from '../domain/labels';
import { CATEGORY_TRIGGER_WORDS, generateTicketDetail, type HardCase, type TicketDetail } from './generate';
import {
  POLITE_SECURITY_TEMPLATES,
  THREAT_PHRASES,
  TRAP_TEMPLATES,
  TRAP_WORDS,
  TWO_ISSUE_CONNECTORS,
  VAGUE_TEMPLATES,
} from './hardCases';
import { createRng } from './rng';
import {
  CLOSERS,
  FEATURES,
  HELDOUT_EVERY,
  OPENERS,
  PLANS,
  PRODUCTS,
  REQUESTS,
  TEMPLATES,
  fillSlots,
  poolOf,
  type Pool,
  type Template,
} from './templates';

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
  // Checked on the two exported files, the only tickets a model ever reads.
  it('shares no run of 4 words between any hand-written row and any exported ticket', () => {
    const rowOf = new Map<string, string>();
    for (const row of ROWS) {
      for (const gram of grams(row.text)) {
        rowOf.set(gram, row.id);
      }
    }
    const shared = new Map<string, string>();
    const { train, heldout } = buildDatasets();
    for (const ticket of [...train, ...heldout]) {
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

describe('poolOf', () => {
  const ITEMS = Array.from({ length: 12 }, (_, index) => index);

  it('hands out the whole list for "all" and splits it for train and held-out with nothing lost or shared', () => {
    expect(poolOf(ITEMS, 'all')).toEqual(ITEMS);
    const train = poolOf(ITEMS, 'train');
    const heldout = poolOf(ITEMS, 'heldout');
    expect(heldout).toEqual([3, 7, 11]);
    expect(HELDOUT_EVERY).toBe(4);
    expect([...train, ...heldout].sort((a, b) => a - b)).toEqual(ITEMS);
    expect(train.filter((item) => heldout.includes(item))).toEqual([]);
  });
});

// A pool with nothing to pick from would crash the export, or (for a subset
// such as the grievance templates a threat follows) crash only on the rare
// ticket that reaches it.
describe('every list a ticket is drawn from has something in both pools', () => {
  const POOLS: Pool[] = ['train', 'heldout'];
  const lists: [string, readonly unknown[]][] = [
    ['vague templates', VAGUE_TEMPLATES],
    ['polite security templates', POLITE_SECURITY_TEMPLATES],
    ['threat phrases', THREAT_PHRASES],
    ['two-issue connectors', TWO_ISSUE_CONNECTORS],
    ['products', PRODUCTS],
    ['plans', PLANS],
    ['features', FEATURES],
    ...CATEGORIES.flatMap((category): [string, readonly unknown[]][] => [
      [`${category} templates`, TEMPLATES[category]],
      [`${category} trap templates`, TRAP_TEMPLATES[category]],
    ]),
  ];

  it.each(POOLS)('in the %s pool', (pool) => {
    for (const [name, list] of lists) {
      expect(poolOf(list, pool).length, `${name} in ${pool}`).toBeGreaterThan(0);
    }
  });

  // Threats follow a grievance template only; the subset is filtered from a
  // pool's templates, the way the generator builds it.
  it.each(POOLS)('keeps a grievance template in every category in the %s pool', (pool) => {
    for (const category of CATEGORIES) {
      const grievances = poolOf(TEMPLATES[category], pool).filter((template) => template.grievance === true);
      expect(grievances.length, `${category} in ${pool}`).toBeGreaterThan(0);
    }
  });

  // "Compare the Pro plan with the Pro plan" reads as nonsense, so a plan always
  // needs another plan in the same pool to be set against.
  it.each(POOLS)('has two plans in the %s pool, so a plan always has another to be compared with', (pool) => {
    expect(poolOf(PLANS, pool).length).toBeGreaterThanOrEqual(2);
  });
});

// The held-out score is only honest if the model never saw the wording it is
// scored on: whole templates, threats, connectors and the product, plan and
// feature names must each belong to one pool. Built with the same seeds and
// counts as the export.
describe('training and held-out wording stay apart', () => {
  const TRAIN_DETAILS = Array.from({ length: 20_000 }, (_, index) => generateTicketDetail(1, index, 'train'));
  const HELDOUT_DETAILS = Array.from({ length: 4000 }, (_, index) => generateTicketDetail(2, index, 'heldout'));

  function templatesOf(details: TicketDetail[]): Set<Template> {
    return new Set(details.flatMap((detail) => detail.templates));
  }

  function textsOf(details: TicketDetail[]): string {
    return details.map((detail) => detail.ticket.text.toLowerCase()).join('\n');
  }

  it('builds no training ticket from a template a held-out ticket uses, and no held-out ticket from one a training ticket uses', () => {
    const trained = templatesOf(TRAIN_DETAILS);
    const heldout = templatesOf(HELDOUT_DETAILS);
    expect(trained.size).toBeGreaterThan(0);
    expect(heldout.size).toBeGreaterThan(0);
    expect([...heldout].filter((template) => trained.has(template)).map((template) => template.text)).toEqual([]);
  });

  it('never puts a product, plan or feature of one pool into the text of the other', () => {
    const valuesOf = (pool: Pool): string[] => [PRODUCTS, PLANS, FEATURES].flatMap((list) => [...poolOf(list, pool)]);
    const trainText = textsOf(TRAIN_DETAILS);
    const heldoutText = textsOf(HELDOUT_DETAILS);
    expect(valuesOf('heldout').filter((value) => trainText.includes(value.toLowerCase()))).toEqual([]);
    expect(valuesOf('train').filter((value) => heldoutText.includes(value.toLowerCase()))).toEqual([]);
  });

  // A connector is a sentence of its own between the two issues.
  it('puts a threat phrase or two-issue connector of one pool only into tickets of that pool', () => {
    const phrasesIn = (details: TicketDetail[], hardCase: HardCase, phrases: readonly string[], wrap: string): string[] => {
      const text = textsOf(details.filter((detail) => detail.ticket.hardCase === hardCase));
      return phrases.filter((phrase) => text.includes(`${wrap}${phrase.toLowerCase()}${wrap}`));
    };
    const heldoutThreats = poolOf(THREAT_PHRASES, 'heldout');
    const trainThreats = poolOf(THREAT_PHRASES, 'train');
    const heldoutLinks = poolOf(TWO_ISSUE_CONNECTORS, 'heldout');
    const trainLinks = poolOf(TWO_ISSUE_CONNECTORS, 'train');
    expect(phrasesIn(TRAIN_DETAILS, 'threatening', heldoutThreats, '')).toEqual([]);
    expect(phrasesIn(HELDOUT_DETAILS, 'threatening', trainThreats, '')).toEqual([]);
    expect(phrasesIn(TRAIN_DETAILS, 'two-issues', heldoutLinks, ' ')).toEqual([]);
    expect(phrasesIn(HELDOUT_DETAILS, 'two-issues', trainLinks, ' ')).toEqual([]);
    // The check can find something: each pool's own phrases do appear.
    expect(phrasesIn(HELDOUT_DETAILS, 'threatening', heldoutThreats, '').length).toBeGreaterThan(0);
    expect(phrasesIn(TRAIN_DETAILS, 'two-issues', trainLinks, ' ').length).toBeGreaterThan(0);
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
