import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_TIMEOUT_MS, fetchModel } from './fetchModel';

const FOLD_FILE = fileURLToPath(new URL('../../public/models/fold_1.json', import.meta.url));

// A connection that never answers, and fails the way fetch does when its signal is aborted.
function silentFetch(): typeof fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchModel', () => {
  // A visitor on a stalled connection would otherwise see "Loading the model..." for ever, with no Retry.
  it('gives up when the file has not come after 60 seconds, so the page can offer Retry', async () => {
    vi.useFakeTimers();
    let outcome = 'waiting';
    fetchModel(1, silentFetch()).then(
      () => {
        outcome = 'loaded';
      },
      () => {
        outcome = 'failed';
      },
    );
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(outcome).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('failed');
  });

  it('loads the model and leaves no timer behind that could cancel anything later', async () => {
    vi.useFakeTimers();
    const body: unknown = JSON.parse(readFileSync(FOLD_FILE, 'utf8'));
    let signal: AbortSignal | undefined;
    const reply: typeof fetch = (_url, init) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve(new Response(JSON.stringify(body)));
    };
    const model = await fetchModel(1, reply);
    expect(model.heads.category.classes.length).toBeGreaterThan(2);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks for the file of the fold it was given and fails on a reply that is not ok', async () => {
    const urls: string[] = [];
    const missing: typeof fetch = (url) => {
      urls.push(String(url));
      return Promise.resolve(new Response('not found', { status: 404 }));
    };
    await expect(fetchModel(3, missing)).rejects.toThrow('E_MODEL_LOAD');
    expect(urls).toEqual(['/models/fold_3.json']);
  });
});
