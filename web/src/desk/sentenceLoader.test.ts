import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { engineIsRecorded, loadDeskSentence } from './sentenceLoader';

// The browser loader, run in Node: the runtime's import() of a page address fails here as a missing file would in a
// browser, and fetch is a stand-in the test answers by hand.

const CLASSES = { category: ['Billing'], priority: ['Low'] } as const;
const PAGE = 'http://localhost/';

// A reply whose body arrives only when the test says so.
function heldReply(): { response: Response; finish: () => void } {
  let finish = (): void => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1000));
      finish = () => {
        controller.enqueue(new Uint8Array(1000));
        controller.close();
      };
    },
  });
  return { response: new Response(body, { status: 200 }), finish: () => finish() };
}

// Whether a promise has settled after the queued work has run.
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return done;
}

beforeEach(() => {
  vi.stubGlobal('document', { baseURI: PAGE });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('engineIsRecorded', () => {
  const ENGINE = readFileSync(new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url));

  it('accepts the engine the runtime record names', async () => {
    expect(await engineIsRecorded(new Uint8Array(ENGINE).buffer)).toBe(true);
  });

  // A cut-off or stale engine served at the same path is refused before the runtime is given it.
  it('refuses an engine one byte shorter', async () => {
    expect(await engineIsRecorded(new Uint8Array(ENGINE.subarray(0, ENGINE.length - 1)).buffer)).toBe(false);
  });
});

describe('loadDeskSentence', () => {
  // A Retry starts a new download only once this one has stopped, so an old download still streaming cannot move the
  // new panel's progress bar or download the engine a second time beside it.
  it('does not give up while the engine is still downloading, though the runtime failed', async () => {
    const engine = heldReply();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(engine.response)));
    const shares: number[] = [];
    const load = loadDeskSentence(CLASSES as never, (share) => shares.push(share));
    load.catch(() => undefined);
    expect(await settled(load)).toBe(false);
    engine.finish();
    await expect(load).rejects.toThrow('E_SENTENCE_LOAD');
    expect(shares.length).toBeGreaterThan(0);
  });

  it('refuses a missing engine with the load error, naming nothing from the address', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
    await expect(loadDeskSentence(CLASSES as never, () => undefined)).rejects.toThrow(/^E_SENTENCE_LOAD$/);
  });

  it('asks only this site for the engine', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        asked.push(String(input));
        return Promise.resolve(new Response('', { status: 404 }));
      }),
    );
    await loadDeskSentence(CLASSES as never, () => undefined).catch(() => undefined);
    expect(asked.every((url) => url.startsWith(`${PAGE}models/`))).toBe(true);
    expect(asked.length).toBe(1);
  });
});
