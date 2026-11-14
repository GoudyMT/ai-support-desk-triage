import { expect, test, type Page, type Request } from '@playwright/test';
import { DEMO_PATH, LOAD_MS, SEED, START } from './helpers';

// The desk while the larger (sentence) model loads or fails to (the owner's lock of 2026-11-12): Start opens a loading
// panel and the run begins once the model is ready; "Start now with the smaller model only" starts at once on the word
// model; a failed or changed download says so and offers Retry and the same button. The model downloads only from this
// site, and only the desk asks for it.

const LARGER = '**/models/{bundle_v2,ort}/**';
const SENTENCE = 'Suggestions: sentence model';
const WORD_ONLY = 'Suggestions: word model only';
const WORD_ONLY_FAILED = 'Suggestions: word model only (the larger model did not load)';

async function openDesk(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${SEED}`);
}

const panel = (page: Page) => page.locator('#loading');
const smallerOnly = (page: Page) => page.getByRole('button', { name: 'Start now with the smaller model only' });
const retry = (page: Page) => panel(page).getByRole('button', { name: 'Retry' });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop' });
const suggests = (page: Page) => page.locator('#suggests');

function watch(page: Page): Request[] {
  const asked: Request[] = [];
  page.on('request', (request) => asked.push(request));
  return asked;
}

test.describe('the larger model loads when Start is pressed', () => {
  test('opening the page asks for no model file; Start shows the panel and the run starts with both models', async ({
    page,
    baseURL,
  }) => {
    const asked = watch(page);
    await openDesk(page);
    await page.waitForLoadState('networkidle');
    expect(asked.filter((request) => request.url().includes('/models/'))).toEqual([]);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(panel(page)).toBeHidden();
    await expect(suggests(page)).toHaveText(SENTENCE);
    // Every file came from this site.
    expect(asked.filter((request) => !request.url().startsWith(baseURL ?? 'none')).map((request) => request.url())).toEqual([]);
  });

  test('on a slow link, the smaller model only starts the run at once and says so', async ({ page }) => {
    // The larger model's files never arrive.
    await page.route(LARGER, () => undefined);
    // A second fetch of the word model would wait behind the larger model's open downloads on a real slow link
    // (a browser opens only a few at a time to one site), so the run must reuse the first.
    const asked = watch(page);
    await openDesk(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(panel(page)).toBeVisible();
    await smallerOnly(page).click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(panel(page)).toBeHidden();
    await expect(suggests(page)).toHaveText(WORD_ONLY);
    expect(asked.filter((request) => request.url().endsWith('/models/shipped.json'))).toHaveLength(1);
  });
});

test.describe('the larger model fails to load', () => {
  test('a missing file says it did not load, and Retry loads it', async ({ page }) => {
    await page.route('**/models/bundle_v2/heads.json', (route) => route.fulfill({ status: 404, body: '' }));
    await openDesk(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(panel(page).getByText('The larger model did not load.')).toBeVisible({ timeout: LOAD_MS });
    await expect(retry(page)).toBeVisible();
    await expect(smallerOnly(page)).toBeVisible();
    await expect(page.locator('#notice')).toHaveText('The larger model did not load.');
    await page.unroute('**/models/bundle_v2/heads.json');
    await retry(page).click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(suggests(page)).toHaveText(SENTENCE);
  });

  test('a changed file is refused like a missing one, and the smaller model runs and names why', async ({ page }) => {
    await page.route('**/models/bundle_v2/manifest.json', (route) => route.fulfill({ status: 200, body: '{"max_length": 128}\n' }));
    await openDesk(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(retry(page)).toBeVisible({ timeout: LOAD_MS });
    await smallerOnly(page).click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(suggests(page)).toHaveText(WORD_ONLY_FAILED);
  });

  test('with reduced motion the panel and the run work the same', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDesk(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(suggests(page)).toHaveText(SENTENCE);
  });
});

// Runs the clock until the run in view has ended and the bar offers Start again.
async function finishRun(page: Page): Promise<void> {
  const toggle = page.locator('#toggle');
  for (let step = 0; step < 60 && (await toggle.innerText()) !== 'Start'; step += 1) await page.clock.runFor(10_000);
  await expect(toggle).toHaveText('Start');
}

// A first run on the smaller model, with the larger model's heads missing so it can never load, played to its end.
async function firstRunEnded(page: Page): Promise<void> {
  await page.route('**/models/bundle_v2/heads.json', (route) => route.fulfill({ status: 404, body: '' }));
  await openDesk(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await smallerOnly(page).click();
  await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
  await finishRun(page);
}

test.describe('Start after a run has ended', () => {
  test('shows the loading panel again, and the smaller model only starts the next run', async ({ page }) => {
    test.setTimeout(120_000);
    await firstRunEnded(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(panel(page)).toBeVisible();
    await smallerOnly(page).click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(panel(page)).toBeHidden();
  });

  test('after the larger model fails, closing Try a ticket leaves Retry and the message on the bar', async ({ page }) => {
    test.setTimeout(120_000);
    await firstRunEnded(page);
    const toggle = page.locator('#toggle');
    await toggle.click();
    await expect(retry(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(toggle).toHaveText('Retry');
    await page.getByRole('button', { name: 'Try a ticket' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(toggle).toHaveText('Retry');
    await expect(page.locator('#notice')).toHaveText('The larger model did not load.');
    await page.unroute('**/models/bundle_v2/heads.json');
    await toggle.click();
    await expect(stop(page)).toBeVisible({ timeout: LOAD_MS });
    await expect(suggests(page)).toHaveText(SENTENCE);
  });
});

test.describe('only the desk loads the larger model', () => {
  for (const path of [DEMO_PATH, '/model-history.html']) {
    test(`${path} asks for no file of the larger model`, async ({ page }) => {
      const asked = watch(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(asked.map((request) => new URL(request.url()).pathname).filter((url) => /\/models\/(bundle_v2|ort)\//.test(url))).toEqual([]);
    });
  }
});
