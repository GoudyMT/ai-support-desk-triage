import { loadModel, type Model } from '../model/scorer';

export const MODEL_TIMEOUT_MS = 60_000;

/**
 * The only request the page makes after its own files: the one fold model a run scores with.
 *
 * @param fold The fold the run's seed names.
 * @param fetcher Where the file comes from; the browser's `fetch` unless a test passes its own.
 * @returns The model, ready to score with.
 * @throws Error('E_MODEL_LOAD') for a failed reply, Error('E_MODEL_SHAPE') for a file that is not a model, and
 *   whatever `fetch` throws when the connection fails or the time runs out.
 */
export async function fetchModel(fold: number, fetcher: typeof fetch = fetch): Promise<Model> {
  // A timer and a controller, not AbortSignal.timeout, so the whole wait covers the body too and a
  // test can move the clock. The signal cuts a stalled download short.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, MODEL_TIMEOUT_MS);
  try {
    const response = await fetcher(`${import.meta.env.BASE_URL}models/fold_${fold}.json`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error('E_MODEL_LOAD');
    }
    return loadModel(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
