import { loadModel, type Model } from '../model/scorer';

export const MODEL_TIMEOUT_MS = 60_000;

/**
 * The request a run makes after the page's own files: the one fold model it scores with. Try a ticket asks for the shipped
 * model on its own (`fetchShipped`).
 *
 * @param fold The fold the run's seed names.
 * @param fetcher Where the file comes from; the browser's `fetch` unless a test passes its own.
 * @returns The model, ready to score with.
 * @throws Error('E_MODEL_LOAD') for a failed reply, Error('E_MODEL_SHAPE') for a file that is not a model, and
 *   whatever `fetch` throws when the connection fails or the time runs out.
 */
export function fetchModel(fold: number, fetcher: typeof fetch = fetch): Promise<Model> {
  return fetchFile(`fold_${fold}`, fetcher);
}

/** The shipped model Try a ticket scores with: the same request, wait and errors as `fetchModel`. */
export function fetchShipped(fetcher: typeof fetch = fetch): Promise<Model> {
  return fetchFile('shipped', fetcher);
}

async function fetchFile(name: string, fetcher: typeof fetch): Promise<Model> {
  // A timer and a controller, not AbortSignal.timeout, so the whole wait covers the body too and a
  // test can move the clock. The signal cuts a stalled download short.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, MODEL_TIMEOUT_MS);
  try {
    const response = await fetcher(`${import.meta.env.BASE_URL}models/${name}.json`, {
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
