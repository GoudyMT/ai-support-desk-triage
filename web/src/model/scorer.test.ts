import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES } from '../domain/labels';
import { loadModel, score, tokenize } from './scorer';

// The Python constant in ml/triage/features.py. The scorer cannot use it (the
// inline flag is a syntax error in JavaScript), so a change on either side has
// to show up here.
const PYTHON_TOKEN_PATTERN = String.raw`(?a)\b\w\w+\b`;
const MODEL_JSON_URL = new URL('./model.json', import.meta.url);

interface RawHead {
  classes: string[];
  vocabulary: string[];
  idf: number[];
  coef: number[][];
  intercept: number[];
}

const TINY_HEAD: RawHead = {
  classes: ['A', 'B', 'C'],
  vocabulary: ['red', 'blue', 'red blue'],
  idf: [1, 2, 3],
  coef: [
    [1, 0, 0.5],
    [0, 1, -0.5],
    [-1, -1, 0],
  ],
  intercept: [0.1, 0, -0.1],
};

function tinyModel(headPatch: Partial<RawHead> = {}, topPatch: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    tokenPattern: PYTHON_TOKEN_PATTERN,
    ngramRange: [1, 2],
    sublinearTf: true,
    heads: { category: { ...TINY_HEAD, ...headPatch }, priority: TINY_HEAD },
    ...topPatch,
  };
}

describe('tokenize', () => {
  // Each expected list is what make_vectorizer().build_analyzer() returns in Python.
  const cases: [string, string, string[]][] = [
    [
      'a non-ASCII letter ends a word, underscores and digits stay in',
      'caf' + String.fromCharCode(0xe9) + ' x_y 4o [CARD_NUMBER]',
      ['caf', 'x_y', '4o', 'card_number', 'caf x_y', 'x_y 4o', '4o card_number'],
    ],
    [
      'an apostrophe splits and a one-letter piece is dropped',
      "Its 2fa isn't working!!",
      ['its', '2fa', 'isn', 'working', 'its 2fa', '2fa isn', 'isn working'],
    ],
    [
      'the Kelvin sign lower-cases to an ASCII k',
      String.fromCharCode(0x212a) + 'ey pad',
      ['key', 'pad', 'key pad'],
    ],
  ];

  it.each(cases)('matches Python when %s', (_name, text, expected) => {
    expect(tokenize(text)).toEqual(expected);
  });
});

describe('loadModel', () => {
  const badModels: [string, unknown][] = [
    ['not an object', null],
    ['no idf', tinyModel({ idf: undefined })],
    ['idf shorter than the vocabulary', tinyModel({ idf: [1, 2] })],
    ['a coef row shorter than the vocabulary', tinyModel({ coef: [[1, 0, 0.5], [0, 1], [-1, -1, 0]] })],
    ['fewer coef rows than classes', tinyModel({ coef: [[1, 0, 0.5], [0, 1, -0.5]] })],
    ['intercept shorter than the classes', tinyModel({ intercept: [0.1, 0] })],
    ['a non-number weight', tinyModel({ idf: [1, 'x', 3] as unknown as number[] })],
    ['two classes (the scorer reads the multi-class form)', tinyModel({ classes: ['A', 'B'], coef: [[1, 0, 0.5], [0, 1, -0.5]], intercept: [0, 0] })],
    ['a missing head', tinyModel({}, { heads: { category: TINY_HEAD } })],
    ['another version', tinyModel({}, { version: 2 })],
    ['a longer n-gram range', tinyModel({}, { ngramRange: [1, 3] })],
    ['no sublinear term frequency', tinyModel({}, { sublinearTf: false })],
    // A repeated term would share one column and shift every later weight.
    ['a repeated vocabulary term', tinyModel({ vocabulary: ['red', 'red', 'red blue'] })],
    // 1e999 is valid JSON text that reads as Infinity, and would turn every score into NaN.
    ['an infinite weight', JSON.parse(JSON.stringify(tinyModel()).replace('"idf":[1,2,3]', '"idf":[1,2,1e999]')) as unknown],
    // Finite, but the products and sums in score overflow and every probability becomes NaN.
    // The intercept stays ordinary, so only the coef bound can refuse this one.
    [
      'a coef value near the largest number',
      tinyModel({ coef: [[1e308, 0, 0], [0, 1, -0.5], [-1, -1, 0]], intercept: [0.1, 0, -1] }),
    ],
    ['an idf value near the largest number', tinyModel({ idf: [1, 2, 1e308] })],
    ['an intercept value near the largest number', tinyModel({ intercept: [0.1, 0, -1e308] })],
    // Two classes with one name would collapse into one entry of the probabilities.
    ['a repeated class name', tinyModel({ classes: ['A', 'A', 'B'] })],
    // A class named like an inherited key would replace a method of the probabilities record.
    ['a class named toString', tinyModel({ classes: ['A', 'toString', 'C'] })],
    ['a class named __proto__', tinyModel({ classes: ['A', '__proto__', 'C'] })],
    // The scorer implements one token pattern; another splits text differently without any error.
    ['another token pattern', tinyModel({}, { tokenPattern: String.raw`(?u)\b\w+\b` })],
    ['no token pattern', tinyModel({}, { tokenPattern: undefined })],
  ];

  it.each(badModels)('rejects a model with %s', (_name, json) => {
    expect(() => loadModel(json)).toThrow('E_MODEL_SHAPE');
  });

  it('accepts weights of a million, far above any a trained model has', () => {
    const model = loadModel(
      tinyModel({ idf: [1e6, 1, 1], coef: [[1e6, 0, 0], [0, 1, -0.5], [-1, -1, 0]], intercept: [1e6, 0, 0] }),
    );
    const prediction = score(model, 'category', 'red');
    expect(prediction.label).toBe('A');
    expect(Number.isFinite(prediction.confidence)).toBe(true);
  });

  it('accepts the shipped model, whose class names are the app labels and whose token pattern is the Python one', () => {
    const json: unknown = JSON.parse(readFileSync(MODEL_JSON_URL, 'utf-8'));
    expect((json as { tokenPattern: string }).tokenPattern).toBe(PYTHON_TOKEN_PATTERN);
    const model = loadModel(json);
    const labels = (name: 'category' | 'priority', words: readonly string[]) => {
      const classes = Object.keys(score(model, name, 'help').probabilities).sort();
      expect(classes).toEqual([...words].sort());
    };
    labels('category', CATEGORIES);
    labels('priority', PRIORITIES);
  });
});

describe('score', () => {
  // Expected numbers computed independently with numpy from the tiny model.
  it('weighs terms as scikit-learn does: 1 + ln(count), idf, length 1, then softmax', () => {
    const prediction = score(loadModel(tinyModel()), 'category', 'red red blue');
    expect(prediction.label).toBe('A');
    expect(prediction.confidence).toBeCloseTo(0.6228519978818157, 12);
    expect(prediction.probabilities['A']).toBeCloseTo(0.6228519978818157, 12);
    expect(prediction.probabilities['B']).toBeCloseTo(0.2866324788336901, 12);
    expect(prediction.probabilities['C']).toBeCloseTo(0.09051552328449428, 12);
    // "blue" is in the text but adds nothing toward A, so it is no chip.
    expect(prediction.topTerms.map((t) => t.term)).toEqual(['red', 'red blue']);
    expect(prediction.topTerms[0]?.weight).toBeCloseTo(0.42506050925680217, 12);
    expect(prediction.topTerms[1]?.weight).toBeCloseTo(0.37657137619562636, 12);
  });

  it('answers with a class other than the first, and takes the words from that class', () => {
    const prediction = score(loadModel(tinyModel()), 'category', 'blue red');
    expect(prediction.label).toBe('B');
    expect(prediction.confidence).toBeCloseTo(0.5545199832509413, 12);
    expect(prediction.probabilities['A']).toBeCloseTo(0.39185397160276764, 12);
    expect(prediction.probabilities['C']).toBeCloseTo(0.053626045146290914, 12);
    expect(prediction.topTerms.map((t) => t.term)).toEqual(['blue']);
    expect(prediction.topTerms[0]?.weight).toBeCloseTo(0.8944271909999159, 12);
  });

  it('shows no word that pushed against the answer', () => {
    // The "red blue" phrase is in the text and lowers class B (-0.246).
    const prediction = score(loadModel(tinyModel()), 'category', 'red blue blue blue blue blue');
    expect(prediction.label).toBe('B');
    expect(prediction.topTerms.map((t) => t.term)).toEqual(['blue']);
    expect(prediction.topTerms[0]?.weight).toBeCloseTo(0.8552470316038023, 12);
  });

  it('gives the intercept answer and no terms when no word is known', () => {
    const prediction = score(loadModel(tinyModel()), 'category', 'zzz qqq');
    expect(prediction.label).toBe('A');
    expect(prediction.probabilities['A']).toBeCloseTo(0.3671654011109255, 12);
    expect(prediction.probabilities['B']).toBeCloseTo(0.3322249935333472, 12);
    expect(prediction.probabilities['C']).toBeCloseTo(0.3006096053557273, 12);
    expect(prediction.topTerms).toEqual([]);
  });

  it('shows the five strongest words, strongest first, whatever their order in the vocabulary', () => {
    // Seven words all push toward class A; their weights are not in vocabulary order.
    const model = loadModel(
      tinyModel({
        vocabulary: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'],
        idf: [1, 1, 1, 1, 1, 1, 1],
        coef: [
          [0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.6],
          [0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
        ],
        intercept: [1, 0, 0],
      }),
    );
    const prediction = score(model, 'category', 'aa bb cc dd ee ff gg');
    expect(prediction.label).toBe('A');
    // Each word has the length-1 value 1/sqrt(7), so its weight is its coef over sqrt(7).
    expect(prediction.topTerms.map((t) => t.term)).toEqual(['dd', 'bb', 'gg', 'ee', 'cc']);
    const expected = [0.9, 0.7, 0.6, 0.5, 0.3].map((c) => c / Math.sqrt(7));
    prediction.topTerms.forEach((t, i) => expect(t.weight).toBeCloseTo(expected[i] ?? NaN, 12));
  });

  it('scores a model with hundreds of thousands of classes', () => {
    const count = 300_000;
    const classes = Array.from({ length: count }, (_, i) => `c${i}`);
    const model = loadModel(
      tinyModel({
        classes,
        vocabulary: ['red'],
        idf: [1],
        coef: classes.map(() => [0]),
        intercept: classes.map((_, i) => (i === count - 1 ? 1 : 0)),
      }),
    );
    const prediction = score(model, 'category', 'red');
    expect(prediction.label).toBe(`c${count - 1}`);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThan(1);
  });

  it('ignores a word the model has never seen', () => {
    const model = loadModel(tinyModel());
    expect(score(model, 'category', 'red red blue qqqzzz')).toEqual(score(model, 'category', 'red red blue'));
  });
});
