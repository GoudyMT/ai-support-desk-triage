import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTicket } from '../generator/generate';
import { loadModel, score, type Model } from '../model/scorer';
import { maskText } from '../privacy/mask';
import { PRESCREEN_WORDS, createPrescreener } from './prescreen';
import { foldOf } from './seed';

// Written out, not read from the code, so a changed cut size cannot change the model
// the tests build.
const EXPECTED_WORDS = 3000;
const CLASSES = ['Low', 'Medium', 'High', 'Urgent'];
const CATEGORY_CLASSES = ['Billing', 'Technical Issue', 'Other'];
const STRONG = 5;
const FILLER_WEIGHT = 0.1;
const FOLD_COUNT = 4;
const TICKETS_PER_SEED = 130;
const FIRST_SEED = 3000;
const SEED_COUNT = 12;
const URGENT_CATCH_SHARE = 0.7;

// One word more than the cut keeps. The first two words rank lowest and both argue for
// High; only the lowest ranks outside the cut. The third argues for Urgent. The rest
// are weak words for Low. A text of one word shows what the cut model does with it.
const DROPPED = 't0000';
const LOWEST_KEPT = 't0001';
const URGENT_WORD = 't0002';
const FILLER = 't0003';

function column(size: number, entries: Record<number, number>): number[] {
  const values = new Array<number>(size).fill(0);
  for (const [at, value] of Object.entries(entries)) {
    values[Number(at)] = value;
  }
  return values;
}

function makeModel(): Model {
  const size = EXPECTED_WORDS + 1;
  const vocabulary = Array.from({ length: size }, (_, i) => `t${String(i).padStart(4, '0')}`);
  const idf = vocabulary.map((_, i) => (i === 0 ? 0.001 : i === 1 ? 0.002 : 1));
  const coef = CLASSES.map((name) => {
    const row = new Array<number>(size).fill(0);
    if (name === 'Low') {
      row.fill(FILLER_WEIGHT, 3);
    }
    if (name === 'High') {
      row[0] = STRONG;
      row[1] = STRONG;
    }
    if (name === 'Urgent') {
      row[2] = STRONG;
    }
    return row;
  });
  const head = { classes: CLASSES, vocabulary, idf, coef, intercept: column(CLASSES.length, { 0: 1 }) };
  // The pre-screener reads the priority head only; the category head just has to be a valid one.
  const category = {
    classes: CATEGORY_CLASSES,
    vocabulary,
    idf,
    coef: CATEGORY_CLASSES.map(() => new Array<number>(size).fill(0)),
    intercept: new Array<number>(CATEGORY_CLASSES.length).fill(0),
  };
  return loadModel({
    version: 1,
    sublinearTf: true,
    tokenPattern: String.raw`(?a)\b\w\w+\b`,
    ngramRange: [1, 2],
    heads: { category, priority: head },
  });
}

describe('createPrescreener on a small model', () => {
  const model = makeModel();
  const tag = createPrescreener(model);

  it('marks a security word critical even when the small model says Low', () => {
    expect(score(model, 'priority', 'my account was hacked').label).toBe('Low');
    expect(tag('my account was hacked')).toEqual({ priority: 'Urgent', critical: true });
  });

  it('keeps the small model label and no mark for a plain text', () => {
    expect(tag(FILLER)).toEqual({ priority: 'Low', critical: false });
    expect(tag(LOWEST_KEPT)).toEqual({ priority: 'High', critical: false });
  });

  it('marks critical when the small model itself says Urgent, with no rule word', () => {
    expect(tag(URGENT_WORD)).toEqual({ priority: 'Urgent', critical: true });
  });

  it('keeps exactly the top words: the lowest ranked goes, the one above it stays', () => {
    expect(PRESCREEN_WORDS).toBe(EXPECTED_WORDS);
    expect(tag(DROPPED).priority).toBe('Low');
    expect(tag(LOWEST_KEPT).priority).toBe('High');
  });

  it('leaves the model it was given unchanged', () => {
    const texts = [DROPPED, LOWEST_KEPT, URGENT_WORD, FILLER, `${LOWEST_KEPT} ${FILLER}`];
    const fresh = makeModel();
    const before = texts.map((text) => score(fresh, 'priority', text));
    createPrescreener(fresh);
    expect(fresh.heads.priority.vocabulary).toHaveLength(EXPECTED_WORDS + 1);
    expect(texts.map((text) => score(fresh, 'priority', text))).toEqual(before);
    expect(score(fresh, 'priority', DROPPED).label).toBe('High');
  });
});

const models = new Map<number, Model>();
function foldModel(fold: number): Model {
  const known = models.get(fold);
  if (known !== undefined) {
    return known;
  }
  const url = new URL(`../../public/models/fold_${fold}.json`, import.meta.url);
  const model = loadModel(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
  models.set(fold, model);
  return model;
}

describe('createPrescreener on real tickets', () => {
  it('marks most truly Urgent tickets critical, using each seed\'s own fold model', () => {
    let urgent = 0;
    let caught = 0;
    for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed += 1) {
      const fold = foldOf(seed);
      expect(fold).toBe(seed % FOLD_COUNT);
      const tag = createPrescreener(foldModel(fold));
      for (let i = 0; i < TICKETS_PER_SEED; i += 1) {
        const ticket = generateTicket(seed, i, { fold, side: 'heldout' });
        if (ticket.label.priority === 'Urgent') {
          urgent += 1;
          caught += tag(maskText(ticket.text).text).critical ? 1 : 0;
        }
      }
    }
    expect(urgent).toBeGreaterThan(0);
    expect(caught / urgent).toBeGreaterThanOrEqual(URGENT_CATCH_SHARE);
  });
});
