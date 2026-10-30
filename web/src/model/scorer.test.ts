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
    ['digits glued to words stay one word', 'win10pro and 3x', ['win10pro', 'and', '3x', 'win10pro and', 'and 3x']],
    ['underscores join words', 'snake_case_word ok', ['snake_case_word', 'ok', 'snake_case_word ok']],
    ['a letter after a non-ASCII letter is a one-letter piece', 'caf' + String.fromCharCode(0xe9) + 's', ['caf']],
    ['one-letter words alone give nothing', 'A  B', []],
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
  ];

  it.each(badModels)('rejects a model with %s', (_name, json) => {
    expect(() => loadModel(json)).toThrow('E_MODEL_SHAPE');
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
    expect(prediction.topTerms.map((t) => t.term)).toEqual(['red', 'red blue', 'blue']);
    expect(prediction.topTerms[0]?.weight).toBeCloseTo(0.42506050925680217, 12);
    expect(prediction.topTerms[1]?.weight).toBeCloseTo(0.37657137619562636, 12);
    expect(prediction.topTerms[2]?.weight).toBe(0);
  });

  it('gives the intercept answer and no terms when no word is known', () => {
    const prediction = score(loadModel(tinyModel()), 'category', 'zzz qqq');
    expect(prediction.label).toBe('A');
    expect(prediction.probabilities['A']).toBeCloseTo(0.3671654011109255, 12);
    expect(prediction.probabilities['B']).toBeCloseTo(0.3322249935333472, 12);
    expect(prediction.probabilities['C']).toBeCloseTo(0.3006096053557273, 12);
    expect(prediction.topTerms).toEqual([]);
  });

  it('ignores a word the model has never seen', () => {
    const model = loadModel(tinyModel());
    expect(score(model, 'category', 'red red blue qqqzzz')).toEqual(score(model, 'category', 'red red blue'));
  });
});
