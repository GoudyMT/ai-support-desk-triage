import { bundle_bytes as BUNDLE_BYTES, fingerprint as FINGERPRINT } from '../../../ml/reports/bundle_v2.json';
import { SENTENCE_FILES, loadSentenceModel, type OrtRuntime, type SentenceClasses, type SentenceModel } from '../model/sentenceScorer';

// Loads the sentence model the site serves: the runtime's engine and the four
// bundle files, all from this site (the page calls no other host), with the
// download's progress. Loaded only when the viewer presses Start or Sort; this
// module itself is fetched only then.

const RUNTIME_FILE = 'ort.wasm.min.mjs';
const ENGINE_FILE = 'ort-wasm-simd-threaded.wasm';
// The engine's size as served (onnxruntime-web 1.31.1); a different size only makes the progress less exact.
const ENGINE_BYTES = 14_848_852;
export const TOTAL_BYTES = ENGINE_BYTES + SENTENCE_FILES.reduce((sum, name) => sum + BUNDLE_BYTES[name], 0);
const LOAD_ERROR = 'E_SENTENCE_LOAD';

interface WebRuntime extends OrtRuntime {
  env: { wasm: { wasmPaths?: string; numThreads?: number; wasmBinary?: ArrayBuffer | Uint8Array } };
}

/**
 * Reads a reply's body, telling `onBytes` how many bytes arrived each time.
 *
 * Args:
 *   response: the reply.
 *   onBytes: called with each piece's size.
 *
 * Returns:
 *   The whole body.
 */
export async function readCounting(response: Response, onBytes: (bytes: number) => void): Promise<Uint8Array> {
  if (response.body === null) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onBytes(whole.length);
    return whole;
  }
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let length = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    pieces.push(read.value);
    length += read.value.length;
    onBytes(read.value.length);
  }
  const whole = new Uint8Array(length);
  let at = 0;
  for (const piece of pieces) {
    whole.set(piece, at);
    at += piece.length;
  }
  return whole;
}

/**
 * Loads the sentence model, reporting the share of the download done.
 *
 * Args:
 *   classes: the answers each head may give.
 *   onProgress: called with the share downloaded, from 0 to 1.
 *
 * Returns:
 *   The model.
 *
 * Throws:
 *   Error('E_SENTENCE_LOAD') when a file cannot be fetched or is not the recorded
 *   bundle; Error('E_SENTENCE_SHAPE') when it cannot be read.
 */
export async function loadDeskSentence(classes: SentenceClasses, onProgress: (share: number) => void): Promise<SentenceModel> {
  // Absolute: a module's import() resolves a relative path against the script's own folder, not the page's.
  const folder = new URL(`${import.meta.env.BASE_URL}models/`, document.baseURI).href;
  let received = 0;
  const counted: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) {
      return response;
    }
    const body = await readCounting(response, (bytes) => {
      received += bytes;
      onProgress(Math.min(received / TOTAL_BYTES, 1));
    });
    return new Response(body as Uint8Array<ArrayBuffer>, { status: response.status });
  };
  let runtime: WebRuntime;
  let engine: Response;
  try {
    [runtime, engine] = await Promise.all([
      import(/* @vite-ignore */ `${folder}ort/${RUNTIME_FILE}`) as Promise<WebRuntime>,
      counted(`${folder}ort/${ENGINE_FILE}`),
    ]);
  } catch {
    throw new Error(LOAD_ERROR);
  }
  if (!engine.ok) {
    throw new Error(LOAD_ERROR);
  }
  // One thread: several need a cross-origin isolated page, which this static site is not.
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.wasmPaths = `${folder}ort/`;
  runtime.env.wasm.wasmBinary = await engine.arrayBuffer();
  return loadSentenceModel(`${folder}bundle_v2/`, FINGERPRINT, runtime, classes, counted);
}
