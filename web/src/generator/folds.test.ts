import { describe, expect, it } from 'vitest';
import { buildFold } from '../../scripts/exportDataset';
import { CATEGORIES, type Category } from '../domain/labels';
import { FAKE_SENTENCES, FEATURES, MONTHS, PLANS, PRODUCTS } from './fakeData';
import { generateTicket, generateTicketDetail, generateTickets, type HardCase, type TicketDetail } from './generate';
import {
  POLITE_SECURITY_TEMPLATES,
  THREAT_PHRASES,
  TRAP_TEMPLATES,
  TWO_ISSUE_CONNECTORS,
  VAGUE_TEMPLATES,
} from './hardCases';
import {
  CLOSERS,
  FOLDS,
  OPENERS,
  REQUESTS,
  TEMPLATES,
  foldsOf,
  poolOf,
  type Side,
  type Split,
  type Template,
} from './templates';

const FOLD_IDS = Array.from({ length: FOLDS }, (_, fold) => fold);
const SIDES: Side[] = ['train', 'heldout'];
const SPLITS: Split[] = FOLD_IDS.flatMap((fold) => SIDES.map((side): Split => ({ fold, side })));
const splitName = (split: Split): string => (split === 'all' ? 'all' : `fold ${split.fold} ${split.side}`);

// The type alone does not guard a caller that passes a value from a form, a URL
// or an old call site that still says 'train'; a wrong split must stop the run
// with a code, not quietly build tickets from the wrong wording.
describe('the split argument', () => {
  const BAD_SPLITS: unknown[] = [
    'train',
    'heldout',
    'ALL',
    null,
    0,
    [],
    {},
    { fold: 0 },
    { side: 'train' },
    { fold: 4, side: 'train' },
    { fold: -1, side: 'heldout' },
    { fold: 1.5, side: 'train' },
    { fold: Number.NaN, side: 'train' },
    { fold: '1', side: 'train' },
    { fold: 0, side: 'test' },
  ];

  // Each split is wrapped so it.each does not spread the empty array as no argument.
  it.each(BAD_SPLITS.map((split) => [split]))('refuses %j with E_SPLIT_RANGE in every entry point', (split) => {
    expect(() => generateTicket(1, 0, split as never)).toThrow('E_SPLIT_RANGE');
    expect(() => generateTicketDetail(1, 0, split as never)).toThrow('E_SPLIT_RANGE');
    expect(() => generateTickets(1, 1, split as never)).toThrow('E_SPLIT_RANGE');
    expect(() => poolOf(['a'], split as never)).toThrow('E_SPLIT_RANGE');
  });

  it('refuses a bad split even when no ticket is asked for', () => {
    expect(() => generateTickets(1, 0, { fold: 4, side: 'train' } as never)).toThrow('E_SPLIT_RANGE');
  });

  it('accepts all, no split at all, and every fold on both sides', () => {
    expect(generateTicket(1, 0)).toEqual(generateTicket(1, 0, 'all'));
    for (const split of SPLITS) {
      expect(generateTicket(1, 0, split).id, splitName(split)).toBe('T-1-0');
    }
  });
});

// The fold of an item decides which model is scored on it, so the assignment
// must give every fold some of every kind of template, not only some templates.
describe('how items are assigned to folds', () => {
  const plain = (text: string): Template => ({ text });
  // Severe templates sit at indices 0, 4, 8 and 12: a plain index % 4 would put
  // all four of them in fold 0.
  const MIXED: Template[] = Array.from({ length: 16 }, (_, index) =>
    index % 4 === 0 ? { text: `severe ${index}`, severe: true } : plain(`plain ${index}`),
  );

  it('puts each item in exactly one fold, one side of every split and nowhere else', () => {
    const lists: (readonly unknown[])[] = [MIXED, PRODUCTS, TEMPLATES.Billing];
    for (const list of lists) {
      const heldoutByFold = FOLD_IDS.map((fold) => poolOf(list, { fold, side: 'heldout' }));
      expect(heldoutByFold.flat().length).toBe(list.length);
      expect(new Set(heldoutByFold.flat()).size).toBe(list.length);
      for (const fold of FOLD_IDS) {
        const train = poolOf(list, { fold, side: 'train' });
        const heldout = heldoutByFold[fold] ?? [];
        expect(train.length + heldout.length).toBe(list.length);
        expect(train.filter((item) => heldout.includes(item))).toEqual([]);
      }
    }
  });

  it('spreads every kind of template over the folds and keeps the fold sizes within one item', () => {
    const heldout = FOLD_IDS.map((fold) => poolOf(MIXED, { fold, side: 'heldout' }));
    for (const items of heldout) {
      expect(items.filter((item) => item.severe === true)).toHaveLength(1);
    }
    const sizes = heldout.map((items) => items.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(foldsOf(MIXED)).toHaveLength(MIXED.length);
  });

  it('gives a plain list one item in four per fold, in list order', () => {
    const items = Array.from({ length: 12 }, (_, index) => `item ${index}`);
    expect(poolOf(items, 'all')).toEqual(items);
    expect(poolOf(items, { fold: 1, side: 'heldout' })).toEqual(['item 1', 'item 5', 'item 9']);
  });
});

// A list with nothing to pick from would crash the export, or (for a subset such
// as the grievance templates a threat follows) crash only on the rare ticket that
// reaches it.
describe('every fold can be built, on both sides', () => {
  const lists: [string, readonly unknown[]][] = [
    ['vague templates', VAGUE_TEMPLATES],
    ['polite security templates', POLITE_SECURITY_TEMPLATES],
    ['threat phrases', THREAT_PHRASES],
    ['two-issue connectors', TWO_ISSUE_CONNECTORS],
    ['products', PRODUCTS],
    ['plans', PLANS],
    ['features', FEATURES],
    ['months', MONTHS],
    ...Object.entries(FAKE_SENTENCES).map(([kind, frames]): [string, readonly unknown[]] => [`${kind} fake-data sentences`, frames]),
    ...CATEGORIES.flatMap((category): [string, readonly unknown[]][] => [
      [`${category} templates`, TEMPLATES[category]],
      [`${category} trap templates`, TRAP_TEMPLATES[category]],
    ]),
  ];

  it.each(SPLITS.map((split) => [splitName(split), split] as const))('has something to draw from in every list, %s', (_name, split) => {
    for (const [name, list] of lists) {
      expect(poolOf(list, split).length, `${name} in ${splitName(split)}`).toBeGreaterThan(0);
    }
    for (const category of CATEGORIES) {
      const grievances = poolOf(TEMPLATES[category], split).filter((template) => template.grievance === true);
      expect(grievances.length, `${category} grievance templates in ${splitName(split)}`).toBeGreaterThan(0);
    }
    // "Compare the Pro plan with the Pro plan" reads as nonsense, so a plan always
    // needs another plan on the same side to be set against.
    expect(poolOf(PLANS, split).length).toBeGreaterThanOrEqual(2);
  });

  it.each(SPLITS.map((split) => [splitName(split), split] as const))('builds 3000 tickets without a failure, %s', (_name, split) => {
    expect(generateTickets(9, 3000, split)).toHaveLength(3000);
  });
});

// A category scored on one or two held-out sentences scores 0 or 100 by which
// sentence sat at that position, so each fold needs enough wording that a
// category's score reflects the category.
describe('every fold holds out enough wording to be a fair exam', () => {
  const MIN_BODIES = 4;
  const MIN_TRAPS = 2;
  const MIN_HARD_CASE_WORDING = 3;
  const MIN_PRODUCTS = 2;
  const MIN_FAKE_SENTENCES = 2;

  it.each(FOLD_IDS)('in fold %i', (fold) => {
    const heldout = (list: readonly unknown[]): number => poolOf(list, { fold, side: 'heldout' }).length;
    const train = (list: readonly unknown[]): number => poolOf(list, { fold, side: 'train' }).length;
    for (const category of CATEGORIES) {
      expect(heldout(TEMPLATES[category]), `${category} bodies`).toBeGreaterThanOrEqual(MIN_BODIES);
      expect(heldout(TRAP_TEMPLATES[category]), `${category} traps`).toBeGreaterThanOrEqual(MIN_TRAPS);
    }
    for (const [name, list] of [
      ['vague', VAGUE_TEMPLATES],
      ['threat', THREAT_PHRASES],
      ['polite-security', POLITE_SECURITY_TEMPLATES],
      ['connector', TWO_ISSUE_CONNECTORS],
    ] as const) {
      expect(heldout(list), name).toBeGreaterThanOrEqual(MIN_HARD_CASE_WORDING);
    }
    expect(heldout(PRODUCTS)).toBeGreaterThanOrEqual(MIN_PRODUCTS);
    // A fake-data frame such as "The card I used is" appears in one category's
    // tickets; one frame on a side would be a cue the model learns.
    for (const [kind, frames] of Object.entries(FAKE_SENTENCES)) {
      expect(heldout(frames), `${kind} held out`).toBeGreaterThanOrEqual(MIN_FAKE_SENTENCES);
      expect(train(frames), `${kind} train`).toBeGreaterThanOrEqual(MIN_FAKE_SENTENCES);
    }
  });
});

interface FoldDetails {
  train: TicketDetail[];
  heldout: TicketDetail[];
}

const detailsCache = new Map<number, FoldDetails>();

// The tickets the export writes for a fold (same seeds, same counts, same walk),
// with the facts and templates each was built from. Built on first use, so a fold
// that cannot be built fails the test that needs it, not the whole file.
function detailsOf(fold: number): FoldDetails {
  const known = detailsCache.get(fold);
  if (known !== undefined) {
    return known;
  }
  const dataset = buildFold(fold);
  const trainSplit: Split = { fold, side: 'train' };
  const heldoutSplit: Split = { fold, side: 'heldout' };
  const built = {
    train: dataset.train.map((ticket) => generateTicketDetail(ticket.seed, ticket.index, trainSplit)),
    heldout: dataset.heldout.map((ticket) => generateTicketDetail(ticket.seed, ticket.index, heldoutSplit)),
  };
  detailsCache.set(fold, built);
  return built;
}

describe('what each fold holds out looks like what it trains on', () => {
  const MAX_SHARE_GAP = 0.1;
  const KINDS: [Category, 'severe' | 'billingDispute' | 'statusQuestion'][] = [
    ['Billing', 'severe'],
    ['Billing', 'billingDispute'],
    ['Technical Issue', 'severe'],
    ['Shipping/Order Issue', 'statusQuestion'],
  ];

  function shareOf(details: TicketDetail[], category: Category, flag: 'severe' | 'billingDispute' | 'statusQuestion'): number {
    const rows = details.filter((detail) => detail.ticket.label.category === category);
    expect(rows.length, category).toBeGreaterThan(0);
    return rows.filter((detail) => detail.facts[flag]).length / rows.length;
  }

  // A held-out set with no duplicate charge in it never tests the duplicate-charge
  // rule, and a held-out set made only of severe tickets flatters a model that
  // always says High.
  it.each(FOLD_IDS)('keeps the severe, dispute and status shares of fold %i within 10 points of training', (fold) => {
    const { train, heldout } = detailsOf(fold);
    for (const [category, flag] of KINDS) {
      const gap = Math.abs(shareOf(heldout, category, flag) - shareOf(train, category, flag));
      expect(gap, `${category} ${flag} in fold ${fold}`).toBeLessThanOrEqual(MAX_SHARE_GAP);
    }
  });

  // The labelling rules call a repeated charge and a crash that repeats High, and
  // fold k is only a test of those rules if its held-out wording has them.
  it.each(FOLD_IDS)('holds out a duplicate-charge and a repeated-crash wording in fold %i, and trains on one', (fold) => {
    const duplicateCharge = /twice|charged again|double charge/i;
    const repeatedCrash = /keeps crashing|crashes every time/i;
    const has = (details: TicketDetail[], category: Category, pattern: RegExp): boolean =>
      details.some(({ templates, ticket }) =>
        ticket.label.category === category && templates.some((template) => template.severe === true && pattern.test(template.text)),
      );
    const { train, heldout } = detailsOf(fold);
    for (const details of [heldout, train]) {
      expect(has(details, 'Billing', duplicateCharge)).toBe(true);
      expect(has(details, 'Technical Issue', repeatedCrash)).toBe(true);
    }
  });
});

// The held-out score is only honest if the model never saw the wording it is
// scored on: whole templates, threats, connectors, fake-data frames and the
// product, plan, feature and month names must each belong to one side of a fold.
describe('training and held-out wording stay apart in every fold', () => {
  function templatesOf(details: TicketDetail[]): Set<Template> {
    return new Set(details.flatMap((detail) => detail.templates));
  }

  function textsOf(details: TicketDetail[]): string {
    return details.map((detail) => detail.ticket.text.toLowerCase()).join('\n');
  }

  it.each(FOLD_IDS)('builds no ticket of fold %i from a template its other side uses', (fold) => {
    const { train, heldout } = detailsOf(fold);
    const trained = templatesOf(train);
    const held = templatesOf(heldout);
    expect(trained.size).toBeGreaterThan(0);
    expect(held.size).toBeGreaterThan(0);
    expect([...held].filter((template) => trained.has(template)).map((template) => template.text)).toEqual([]);
  });

  it.each(FOLD_IDS)('never puts a product, plan, feature or month of one side of fold %i into the text of the other', (fold) => {
    const { train, heldout } = detailsOf(fold);
    const valuesOf = (side: Side): string[] => [PRODUCTS, PLANS, FEATURES].flatMap((list) => [...poolOf(list, { fold, side })]);
    // A month shows only as a date such as "april 12", so "may" in "it may" is not one.
    const monthsIn = (text: string): Set<string> => new Set([...text.matchAll(/\b([a-z]+) \d{1,2}\b/g)].map((match) => match[1] ?? ''));
    const leaks = (side: Side, text: string): string[] => [
      ...valuesOf(side).filter((value) => text.includes(value.toLowerCase())),
      ...poolOf(MONTHS, { fold, side }).filter((month) => monthsIn(text).has(month.toLowerCase())),
    ];
    expect(leaks('heldout', textsOf(train))).toEqual([]);
    expect(leaks('train', textsOf(heldout))).toEqual([]);
  });

  // The frame in front of an email, phone, order or card is wording like any
  // other: "The card I used is" must not mark one side.
  it.each(FOLD_IDS)('puts a fake-data sentence of one side of fold %i only into tickets of that side', (fold) => {
    const { train, heldout } = detailsOf(fold);
    const frames = (side: Side): string[] => Object.values(FAKE_SENTENCES).flatMap((list) => [...poolOf(list, { fold, side })]);
    // The value (email, phone, order number or card) is masked so only the frame is left.
    const masked = (details: TicketDetail[]): string[] =>
      details
        .filter((detail) => detail.ticket.hasFakeData)
        .map((detail) => detail.ticket.text.replace(/ORD-\d{6}|[\w.]+@example\.(?:com|org)|555-01\d\d|(?:\d{4} ){3}\d{4}/g, '{value}'));
    const found = (list: string[], texts: string[]): number => texts.filter((text) => list.some((frame) => text.includes(frame))).length;
    expect(found(frames('heldout'), masked(train))).toBe(0);
    expect(found(frames('train'), masked(heldout))).toBe(0);
    expect(found(frames('heldout'), masked(heldout))).toBeGreaterThan(0);
    expect(found(frames('train'), masked(train))).toBeGreaterThan(0);
  });

  // A connector is a sentence of its own between the two issues.
  it.each(FOLD_IDS)('puts a threat phrase or two-issue connector of one side of fold %i only into tickets of that side', (fold) => {
    const { train, heldout } = detailsOf(fold);
    const phrasesIn = (details: TicketDetail[], hardCase: HardCase, phrases: readonly string[], wrap: string): string[] => {
      const text = textsOf(details.filter((detail) => detail.ticket.hardCase === hardCase));
      return phrases.filter((phrase) => text.includes(`${wrap}${phrase.toLowerCase()}${wrap}`));
    };
    const heldoutThreats = poolOf(THREAT_PHRASES, { fold, side: 'heldout' });
    const trainThreats = poolOf(THREAT_PHRASES, { fold, side: 'train' });
    const heldoutLinks = poolOf(TWO_ISSUE_CONNECTORS, { fold, side: 'heldout' });
    const trainLinks = poolOf(TWO_ISSUE_CONNECTORS, { fold, side: 'train' });
    expect(phrasesIn(train, 'threatening', heldoutThreats, '')).toEqual([]);
    expect(phrasesIn(heldout, 'threatening', trainThreats, '')).toEqual([]);
    expect(phrasesIn(train, 'two-issues', heldoutLinks, ' ')).toEqual([]);
    expect(phrasesIn(heldout, 'two-issues', trainLinks, ' ')).toEqual([]);
    // The check can find something: each side's own phrases do appear.
    expect(phrasesIn(heldout, 'threatening', heldoutThreats, '').length).toBeGreaterThan(0);
    expect(phrasesIn(train, 'two-issues', trainLinks, ' ').length).toBeGreaterThan(0);
  });
});

// A word that belongs only to a held-out product, plan, feature or month, yet
// sits in training wording ("workspace" in an Account Access sentence), would let
// the model learn the category from the slot word. Words both sides share
// ("team", "plan") are exempt.
describe('held-out slot words stay out of training wording in every fold', () => {
  const wordsOf = (text: string): string[] => text.toLowerCase().replace(/\{\w+\}/g, ' ').split(/[^a-z0-9]+/).filter((w) => w !== '');
  const slotLists = [PRODUCTS, PLANS, FEATURES, MONTHS];

  it.each(FOLD_IDS)('puts no held-out-only slot word of fold %i into any training sentence', (fold) => {
    const heldoutSplit: Split = { fold, side: 'heldout' };
    const trainSplit: Split = { fold, side: 'train' };
    const trainValueWords = new Set(slotLists.flatMap((list) => poolOf(list, trainSplit).flatMap(wordsOf)));
    const heldoutOnly = new Set(
      slotLists.flatMap((list) => poolOf(list, heldoutSplit).flatMap(wordsOf)).filter((word) => !trainValueWords.has(word)),
    );
    const trainSentences = [
      ...CATEGORIES.flatMap((category) => [...poolOf(TEMPLATES[category], trainSplit), ...poolOf(TRAP_TEMPLATES[category], trainSplit)]).map(
        (template) => template.text,
      ),
      ...poolOf(VAGUE_TEMPLATES, trainSplit).map((template) => template.text),
      ...poolOf(POLITE_SECURITY_TEMPLATES, trainSplit).map((template) => template.text),
      ...poolOf(THREAT_PHRASES, trainSplit),
      ...poolOf(TWO_ISSUE_CONNECTORS, trainSplit),
      ...Object.values(FAKE_SENTENCES).flatMap((frames) => poolOf(frames, trainSplit)),
      ...OPENERS,
      ...CLOSERS,
      ...REQUESTS,
    ];
    expect(heldoutOnly.size).toBeGreaterThan(0);
    const leaks = trainSentences.flatMap((sentence) => wordsOf(sentence).filter((word) => heldoutOnly.has(word)).map((word) => `"${word}" in "${sentence}"`));
    expect(leaks, leaks.join('\n')).toEqual([]);
  });
});
