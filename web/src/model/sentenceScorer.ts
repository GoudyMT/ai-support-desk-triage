import type * as Ort from 'onnxruntime-web';
import type { Category, Priority } from '../domain/labels';
import { maxTokensOf, tokenizerFrom, type WordPieceTokenizer } from './wordPiece';

// The sentence model in the browser: the same bundle the Python scorer measured,
// checked by the same fingerprint, scored the same way (mean of the token
// vectors, scaled to length 1, then a linear head per answer). It is large, so
// the desk loads it on demand; the runtime is passed in, so the page loads the
// copy the site serves and a test in Node loads the package's own.

export type OrtRuntime = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>;

export interface SentenceAnswer {
  category: Category;
  priority: Priority;
  // The model's probability for each chosen answer.
  categoryProbability: number;
  priorityProbability: number;
}

export interface SentenceModel {
  predict(maskedText: string): Promise<SentenceAnswer>;
}

// The answers each head may give (domain/labels' CATEGORIES and PRIORITIES), passed in so this
// module, which the desk fetches on demand, shares no code with the page's first files.
export interface SentenceClasses {
  category: readonly Category[];
  priority: readonly Priority[];
}

// The four files that decide the answers, in the order their digests are joined.
export const SENTENCE_FILES = ['model_quantized.onnx', 'tokenizer.json', 'heads.json', 'manifest.json'] as const;
export type SentenceFiles = Record<(typeof SENTENCE_FILES)[number], Uint8Array>;

const LOAD_ERROR = 'E_SENTENCE_LOAD';
const SHAPE_ERROR = 'E_SENTENCE_SHAPE';
const CR = 0x0d;
const LF = 0x0a;
// A ticket with no known word has a zero vector; dividing by this instead of by
// zero leaves it zero, as the Python scorer does.
const MIN_NORM = 1e-12;

interface Head {
  classes: string[];
  weight: number[][];
  bias: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (item: unknown): item is number => typeof item === 'number' && Number.isFinite(item);

// Git on Windows checks JSON out with CRLF line ends; the fingerprint is of the LF form.
function withLf(bytes: Uint8Array): Uint8Array {
  return bytes.filter((byte, at) => !(byte === CR && bytes[at + 1] === LF));
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Works out a bundle's fingerprint as the Python scorer does.
 *
 * Args:
 *   files: the four bundle files' bytes.
 *
 * Returns:
 *   The SHA-256, in hex, of the four files' SHA-256 digests joined by newlines.
 */
export async function fingerprintOf(files: SentenceFiles): Promise<string> {
  const digests = await Promise.all(
    SENTENCE_FILES.map(async (name) => {
      const bytes = name.endsWith('.json') ? withLf(files[name]) : files[name];
      return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    }),
  );
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digests.join('\n'))));
}

function headOf(value: unknown, classes: readonly string[]): Head {
  if (!isRecord(value)) {
    throw new Error(SHAPE_ERROR);
  }
  const { classes: named, weight, bias } = value;
  const width = Array.isArray(weight) && Array.isArray(weight[0]) ? weight[0].length : 0;
  const shaped =
    Array.isArray(named) &&
    named.length === classes.length &&
    named.every((name) => typeof name === 'string' && classes.includes(name)) &&
    Array.isArray(weight) &&
    weight.length === named.length &&
    width > 0 &&
    weight.every((row) => Array.isArray(row) && row.length === width && row.every(isFiniteNumber)) &&
    Array.isArray(bias) &&
    bias.length === named.length &&
    bias.every(isFiniteNumber);
  if (!shaped) {
    throw new Error(SHAPE_ERROR);
  }
  return { classes: named as string[], weight: weight as number[][], bias: bias as number[] };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(SHAPE_ERROR);
  }
}

// The class with the highest score and its softmax probability. The first class
// wins a tie, as numpy's argmax picks.
function choose(head: Head, vector: Float32Array): { label: string; probability: number } {
  const scores = head.weight.map((row, at) => row.reduce((sum, weight, i) => sum + weight * (vector[i] ?? 0), head.bias[at] ?? 0));
  const top = Math.max(...scores);
  const best = scores.indexOf(top);
  const total = scores.reduce((sum, score) => sum + Math.exp(score - top), 0);
  return { label: head.classes[best] ?? '', probability: 1 / total };
}

// The mean of the token vectors (every token is real: one ticket, no padding), scaled to length 1.
function sentenceVector(hidden: Float32Array, tokens: number, width: number): Float32Array {
  const vector = new Float32Array(width);
  for (let token = 0; token < tokens; token += 1) {
    for (let i = 0; i < width; i += 1) {
      vector[i] = (vector[i] ?? 0) + (hidden[token * width + i] ?? 0) / tokens;
    }
  }
  const norm = Math.max(Math.hypot(...vector), MIN_NORM);
  return vector.map((value) => value / norm);
}

async function answer(runtime: OrtRuntime, session: Ort.InferenceSession, tokenizer: WordPieceTokenizer, heads: { category: Head; priority: Head }, text: string): Promise<SentenceAnswer> {
  const ids = tokenizer.encode(text);
  const shape = [1, ids.length];
  const feeds: Record<string, Ort.Tensor> = {
    input_ids: new runtime.Tensor('int64', BigInt64Array.from(ids, BigInt), shape),
    attention_mask: new runtime.Tensor('int64', new BigInt64Array(ids.length).fill(1n), shape),
    token_type_ids: new runtime.Tensor('int64', new BigInt64Array(ids.length), shape),
  };
  const wanted = Object.fromEntries(session.inputNames.map((name) => [name, feeds[name]]));
  if (Object.values(wanted).some((tensor) => tensor === undefined)) {
    throw new Error(SHAPE_ERROR);
  }
  const output = (await session.run(wanted as Record<string, Ort.Tensor>))[session.outputNames[0] ?? ''];
  const width = output?.dims[2];
  if (output === undefined || !(output.data instanceof Float32Array) || width === undefined || output.dims[1] !== ids.length) {
    throw new Error(SHAPE_ERROR);
  }
  const vector = sentenceVector(output.data, ids.length, width);
  const category = choose(heads.category, vector);
  const priority = choose(heads.priority, vector);
  return {
    category: category.label as Category,
    priority: priority.label as Priority,
    categoryProbability: category.probability,
    priorityProbability: priority.probability,
  };
}

/**
 * Builds the sentence model from its four files, after proving they are the recorded bundle.
 *
 * Args:
 *   files: the bundle files' bytes.
 *   expectedFingerprint: the fingerprint every record of the model was measured on.
 *   runtime: the ONNX runtime to score with.
 *
 * Returns:
 *   A model that answers one masked ticket at a time.
 *
 * Throws:
 *   Error('E_SENTENCE_LOAD') when the files are not the recorded bundle (cut off or
 *   changed); Error('E_SENTENCE_SHAPE') when they cannot be read as a bundle.
 */
export async function sentenceModelFrom(files: SentenceFiles, expectedFingerprint: string, runtime: OrtRuntime, classes: SentenceClasses): Promise<SentenceModel> {
  if ((await fingerprintOf(files)) !== expectedFingerprint) {
    throw new Error(LOAD_ERROR);
  }
  const headsJson = parseJson(files['heads.json']);
  if (!isRecord(headsJson)) {
    throw new Error(SHAPE_ERROR);
  }
  const heads = { category: headOf(headsJson['category'], classes.category), priority: headOf(headsJson['priority'], classes.priority) };
  const tokenizer = tokenizerFrom(parseJson(files['tokenizer.json']), maxTokensOf(parseJson(files['manifest.json'])));
  let session: Ort.InferenceSession;
  try {
    session = await runtime.InferenceSession.create(files['model_quantized.onnx']);
  } catch {
    throw new Error(LOAD_ERROR);
  }
  return { predict: (maskedText) => answer(runtime, session, tokenizer, heads, maskedText) };
}

/**
 * Fetches the bundle the site serves and builds the sentence model from it.
 *
 * Args:
 *   folder: the URL of the served bundle folder, ending in '/'.
 *   expectedFingerprint: the recorded fingerprint.
 *   runtime: the ONNX runtime to score with.
 *   fetcher: how to fetch a file (the page's fetch by default).
 *
 * Returns:
 *   The model.
 *
 * Throws:
 *   Error('E_SENTENCE_LOAD') when a file cannot be fetched or is not the
 *   recorded bundle; Error('E_SENTENCE_SHAPE') as for sentenceModelFrom.
 */
export async function loadSentenceModel(
  folder: string,
  expectedFingerprint: string,
  runtime: OrtRuntime,
  classes: SentenceClasses,
  fetcher: typeof fetch = fetch,
): Promise<SentenceModel> {
  const fetched = await Promise.all(
    SENTENCE_FILES.map(async (name): Promise<[string, Uint8Array]> => {
      let response: Response;
      try {
        response = await fetcher(`${folder}${name}`);
      } catch {
        throw new Error(LOAD_ERROR);
      }
      if (!response.ok) {
        throw new Error(LOAD_ERROR);
      }
      return [name, new Uint8Array(await response.arrayBuffer())];
    }),
  );
  return sentenceModelFrom(Object.fromEntries(fetched) as SentenceFiles, expectedFingerprint, runtime, classes);
}
