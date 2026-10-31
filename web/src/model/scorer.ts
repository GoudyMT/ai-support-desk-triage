export type HeadName = 'category' | 'priority';

export interface Prediction {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
  topTerms: { term: string; weight: number }[];
}

interface ScoringHead {
  classes: string[];
  vocabulary: string[];
  index: Map<string, number>;
  idf: number[];
  coef: number[][];
  intercept: number[];
}

export interface Model {
  heads: Record<HeadName, ScoringHead>;
}

const SHAPE_ERROR = 'E_MODEL_SHAPE';
// Only the multi-class softmax is implemented; a two-class scikit-learn model
// stores one row of weights, which this scorer would misread.
const MIN_CLASSES = 3;
const TOP_TERM_COUNT = 5;

// Python's pattern is "(?a)\b\w\w+\b"; JavaScript rejects the inline flag. Without
// the u flag, \w and \b here are ASCII-only, which is what (?a) asks of Python,
// so both sides split text the same way.
const TOKEN = /\b\w\w+\b/g;

// The scorer implements exactly this vectorizer; a model made with other
// settings would score wrongly without any error, so it is refused.
const SUPPORTED_NGRAM_RANGE = [1, 2];

// The Python constant in ml/triage/features.py, which the pattern above stands in for.
const PYTHON_TOKEN_PATTERN = String.raw`(?a)\b\w\w+\b`;

// A trained weight is a few units (the shipped model's largest is about 10). A
// value near the largest number overflows the sums in `score` into NaN, so
// anything past this much-larger bound is refused instead.
const MAX_WEIGHT_MAGNITUDE = 1e6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOf<T>(value: unknown, test: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(test);
}

const isString = (item: unknown): item is string => typeof item === 'string';
const isNumber = (item: unknown): item is number =>
  typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= MAX_WEIGHT_MAGNITUDE;
const isNumberArray = (item: unknown): item is number[] => isArrayOf(item, isNumber);

function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) {
    throw new Error(SHAPE_ERROR);
  }
  return item;
}

function parseHead(raw: unknown): ScoringHead {
  if (!isRecord(raw)) {
    throw new Error(SHAPE_ERROR);
  }
  const { classes, vocabulary, idf, coef, intercept } = raw;
  if (
    !isArrayOf(classes, isString) ||
    !isArrayOf(vocabulary, isString) ||
    !isNumberArray(idf) ||
    !isArrayOf(coef, isNumberArray) ||
    !isNumberArray(intercept)
  ) {
    throw new Error(SHAPE_ERROR);
  }
  const index = new Map(vocabulary.map((term, i) => [term, i] as const));
  if (
    classes.length < MIN_CLASSES ||
    // Class names become keys of the probabilities record: a repeated name would
    // merge two classes, and one that is an inherited key ("toString") would
    // replace a method of the record.
    new Set(classes).size !== classes.length ||
    classes.some((name) => name in {}) ||
    index.size !== vocabulary.length ||
    idf.length !== vocabulary.length ||
    coef.length !== classes.length ||
    coef.some((row) => row.length !== vocabulary.length) ||
    intercept.length !== classes.length
  ) {
    throw new Error(SHAPE_ERROR);
  }
  return { classes, vocabulary, index, idf, coef, intercept };
}

/**
 * Reads the model file content into a form `score` can use.
 *
 * @param json The parsed content of model.json.
 * @returns The model.
 * @throws Error('E_MODEL_SHAPE') when anything is missing, mis-sized, or made with settings this scorer does not implement.
 */
export function loadModel(json: unknown): Model {
  if (
    !isRecord(json) ||
    json['version'] !== 1 ||
    json['sublinearTf'] !== true ||
    json['tokenPattern'] !== PYTHON_TOKEN_PATTERN ||
    !isNumberArray(json['ngramRange']) ||
    json['ngramRange'].join() !== SUPPORTED_NGRAM_RANGE.join() ||
    !isRecord(json['heads'])
  ) {
    throw new Error(SHAPE_ERROR);
  }
  const heads = json['heads'];
  return {
    heads: {
      category: parseHead(heads['category']),
      priority: parseHead(heads['priority']),
    },
  };
}

/**
 * Splits text into the terms scikit-learn's vectorizer would build.
 *
 * @param text Any masked ticket text.
 * @returns The one-word terms, then the two-word terms joined by one space.
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(TOKEN) ?? [];
  const pairs: string[] = [];
  for (const [i, word] of words.entries()) {
    const next = words[i + 1];
    if (next !== undefined) {
      pairs.push(`${word} ${next}`);
    }
  }
  return [...words, ...pairs];
}

// A loop, not Math.max(...scores): spreading hundreds of thousands of values
// overflows the call stack.
function maxOf(values: readonly number[]): number {
  let top = -Infinity;
  for (const value of values) {
    if (value > top) {
      top = value;
    }
  }
  return top;
}

function softmax(scores: number[]): number[] {
  const top = maxOf(scores);
  const exps = scores.map((s) => Math.exp(s - top));
  const total = exps.reduce((sum, e) => sum + e, 0);
  return exps.map((e) => e / total);
}

/**
 * Scores a masked ticket text with one head.
 *
 * @param model A model from `loadModel`.
 * @param head Which question to answer.
 * @param maskedText The ticket text after masking.
 * @returns The most likely class, its probability, every class's probability,
 *   and the words of the text that pushed toward that class, strongest first, at
 *   most 5 (fewer, or none, when fewer words pushed toward it).
 */
export function score(model: Model, head: HeadName, maskedText: string): Prediction {
  const { classes, vocabulary, index, idf, coef, intercept } = model.heads[head];
  const counts = new Map<number, number>();
  for (const term of tokenize(maskedText)) {
    const column = index.get(term);
    if (column !== undefined) {
      counts.set(column, (counts.get(column) ?? 0) + 1);
    }
  }
  // Sublinear term frequency times idf, then scaled to length 1 (a text with no
  // known term stays all zero, as in scikit-learn).
  const weights = [...counts].map(([column, count]) => ({
    column,
    value: (1 + Math.log(count)) * at(idf, column),
  }));
  const length = Math.sqrt(weights.reduce((sum, w) => sum + w.value * w.value, 0));
  const present = weights.map((w) => ({ column: w.column, value: length > 0 ? w.value / length : 0 }));

  const scores = classes.map(
    (_, c) => present.reduce((sum, w) => sum + w.value * at(at(coef, c), w.column), 0) + at(intercept, c),
  );
  const probabilities = softmax(scores);
  const best = scores.indexOf(maxOf(scores));
  const topTerms = present
    .map((w) => ({ term: at(vocabulary, w.column), weight: w.value * at(at(coef, best), w.column) }))
    // Only words that pushed toward the answer: a chip for a word that argued
    // against it would show the visitor something the model did not rely on.
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TOP_TERM_COUNT);
  return {
    label: at(classes, best),
    confidence: at(probabilities, best),
    probabilities: Object.fromEntries(classes.map((name, c) => [name, at(probabilities, c)])),
    topTerms,
  };
}
