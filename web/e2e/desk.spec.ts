import { expect, test, type Page } from '@playwright/test';
import { foldOf } from '../src/run/seed';
import { generateTicket } from '../src/generator/generate';
import { maskText } from '../src/privacy/mask';
import { SEED, START } from './helpers';

const TICKETS_IN_A_RUN = 130;
const RUN_STEP_MS = 10_000;
const MAX_RUN_STEPS = 60;
const ENDED = 'All 130 tickets handled. Open More numbers and report, or press Start to run a new set.';
const MODEL_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
const TAG_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STARTED = 'Run started.';

// Opens the desk with the clock under the test's control: nothing moves until `runFor`.
async function openDesk(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/${query}`);
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
}

// Every ticket a run of this seed can show, as the page masks it: a row outside this set is not from the seed's run.
function realTexts(seed: number): Set<string> {
  const fold = foldOf(seed);
  return new Set(
    Array.from({ length: TICKETS_IN_A_RUN }, (_, index) =>
      maskText(generateTicket(seed, index, { fold, side: 'heldout' }).text).text,
    ),
  );
}

// A changed number fades out and then in on the browser's own clock, not the test's, so its text is final only once the
// animations are over.
async function fadesDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
    .toBe(0);
}

// Lets a run go to its end, the way the finished-run rows below do.
async function finishRun(page: Page): Promise<void> {
  const toggle = page.locator('#toggle');
  for (let step = 0; step < MAX_RUN_STEPS && (await toggle.innerText()) !== 'Start'; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
  }
  await expect(toggle).toHaveText('Start');
  await expect(page.getByText(ENDED)).toBeVisible();
}

// Holds every model file back until `release` is called, so a load can be watched while it is still going.
async function holdModels(page: Page): Promise<{ release: () => void }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((open) => {
    release = open;
  });
  await page.route('**/models/*', async (route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

const tryButton = (page: Page) => page.getByRole('button', { name: 'Try a ticket' });
const openCards =(page: Page) => page.locator('#open-list > li');
const sentRows = (page: Page) => page.locator('#sent-list > li');

async function texts(page: Page, selector: string): Promise<string[]> {
  // The raw text, not innerText: a ticket's line breaks show as spaces, and the check is against the ticket itself.
  return page.locator(selector).allTextContents();
}

test('at rest the desk says what it is, shows its three measured numbers and Start, and asks for no model', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await openDesk(page);
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'You are the support team. Tickets reach your desk already sorted.',
    }),
  ).toBeVisible();
  for (const number of ['0 of 24', '39 of 48', '78%']) {
    await expect(page.getByText(number, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('tickets written for this project, category right; the old keyword method got 14')).toBeVisible();
  await expect(page.getByText('of tickets on the blind test set still went to a person')).toBeVisible();
  await expect(
    page.getByText(
      'Press Start and made-up tickets arrive. A trained model sorts them. A simulated reviewer clears what it flags, and you can step in on any ticket. Nothing here is a real customer.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Measured on every code change. A live run is harder: about 89% of tickets go to a person, and a high-risk ticket is sometimes missed.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Under the Hood' })).toHaveAttribute('href', 'under-the-hood.html');
  expect(asked.filter((path) => path.includes('/models/'))).toEqual([]);
});

test('the Model History link on the desk goes to the model history page', async ({ page }) => {
  await openDesk(page);
  await page.getByRole('link', { name: 'Model History' }).click();
  await expect(page).toHaveURL(/\/model-history\.html$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Model History' })).toBeVisible();
});

test('a run fills both lists from the real tickets, with matching counts and the most serious first', async ({
  page,
}) => {
  await openDesk(page);
  await start(page);
  const real = realTexts(SEED);
  const seenTags = new Set<string>();
  for (let step = 0; step < 9; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
    const tags = await texts(page, '#open-list .tag');
    for (const tag of tags) seenTags.add(tag);
    const ranks = tags.map((tag) => TAG_RANK[tag] ?? Number.NaN);
    expect(ranks, `tags at ${(step + 1) * RUN_STEP_MS} ms`).toEqual([...ranks].sort((a, b) => a - b));
  }
  expect(await openCards(page).count()).toBeGreaterThan(0);
  expect(await sentRows(page).count()).toBeGreaterThan(0);
  await expect(page.locator('#open-count')).toHaveText(String(await openCards(page).count()));
  await expect(page.locator('#sent-count')).toHaveText(String(await sentRows(page).count()));
  await expect(page.locator('#n-closed')).toHaveText(`${await sentRows(page).count()} of ${TICKETS_IN_A_RUN}`);
  for (const text of [...(await texts(page, '#open-list .text')), ...(await texts(page, '#sent-list .text'))]) {
    expect(real.has(text), text).toBe(true);
  }
  for (const tag of seenTags) expect(Object.keys(TAG_RANK)).toContain(tag);
});

test('a Critical tag is the word Critical in the tag color of the demo', async ({ page }) => {
  await openDesk(page);
  await start(page);
  const critical = page.locator('#open-list .tag-critical').first();
  for (let step = 0; step < MAX_RUN_STEPS && (await critical.count()) === 0; step += 1) {
    await page.clock.runFor(RUN_STEP_MS / 2);
  }
  await expect(critical).toHaveText('Critical');
  const colors = await critical.evaluate((node) => ({
    shown: getComputedStyle(node).backgroundColor,
    token: (() => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--tag-critical-bg)';
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    })(),
  }));
  expect(colors.shown).toBe(colors.token);
});

test('Stop holds every list and number until Start picks the run up again', async ({ page }) => {
  await openDesk(page);
  await start(page);
  await page.clock.runFor(30_000);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(page.getByText('Stopped.')).toBeVisible();
  await fadesDone(page);
  const held = await page.locator('#run').innerText();
  expect(await sentRows(page).count()).toBeGreaterThan(0);
  await page.clock.runFor(60_000);
  await fadesDone(page);
  expect(await page.locator('#run').innerText()).toBe(held);
  await page.getByRole('button', { name: 'Start' }).click();
  await page.clock.runFor(30_000);
  expect(await page.locator('#run').innerText()).not.toBe(held);
});

// A hold the viewer did not ask for is not "Stopped.": the bar says what the run is waiting for, in the status and not in
// the live region, and goes back to the real state when the hold ends.
test('while the report is open the bar says the run is paused for reading, and a real Stop still says Stopped', async ({
  page,
}) => {
  await openDesk(page);
  await start(page);
  await page.clock.runFor(30_000);
  await page.getByRole('button', { name: /^(More numbers and report|Fewer numbers)$/ }).click();
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.locator('#status')).toHaveText('Paused while you read the report.');
  await expect(page.locator('#notice')).toBeEmpty();
  await page.getByRole('button', { name: 'Close report' }).click();
  // The lists come back under a pointer left where Close report was, which holds the run, so it moves away.
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('#notice')).toHaveText('Stopped.');
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.locator('#status')).toHaveText('Paused while you read the report.');
  await expect(page.locator('#notice')).toBeEmpty();
  await page.getByRole('button', { name: 'Close report' }).click();
  await expect(page.locator('#notice')).toHaveText('Stopped.');
  await expect(page.locator('#status')).toBeEmpty();
});

test('a model that fails to load shows a plain message and Retry, and Retry starts the run', async ({ page }) => {
  await page.route('**/models/*', (route) => route.abort());
  await openDesk(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(MODEL_FAILED)).toBeVisible();
  // The page still works: the link out is there and the desk is still at rest.
  await expect(page.getByRole('link', { name: 'Under the Hood' })).toBeVisible();
  await expect(page.locator('#rest')).toBeVisible();
  await page.unroute('**/models/*');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByText(MODEL_FAILED)).toBeHidden();
  await page.clock.runFor(30_000);
  expect(await sentRows(page).count()).toBeGreaterThan(0);
});

// A screen reader hears nothing when a run starts unless the live region says so.
test('Start says once, in the live region, that the run started', async ({ page }) => {
  await openDesk(page);
  await expect(page.locator('#notice')).toBeEmpty();
  await start(page);
  await expect(page.locator('#notice')).toHaveText(STARTED);
  await page.clock.runFor(10_000);
  await expect(page.locator('#notice')).toBeEmpty();
});

test('Start on an address whose seed cannot be used says so and names the seed it ran', async ({ page }) => {
  await openDesk(page, '?seed=abc');
  await start(page);
  const seed = await page.locator('body').getAttribute('data-seed');
  expect(seed).toMatch(/^\d+$/);
  await expect(page.locator('#notice')).toHaveText(
    `The seed in the replay link could not be used, so this is a new run with seed ${seed}.`,
  );
});

// The bar says what the viewer needs most: at the end it says so, whatever is open over it.
test('at the end of a run the bar says so while Try a ticket or a report is open, not that it is paused', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDesk(page);
  await start(page);
  await finishRun(page);
  await tryButton(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#notice')).toHaveText(ENDED);
  await expect(page.locator('#status')).toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: /^(More numbers and report|Fewer numbers)$/ }).click();
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#notice')).toHaveText(ENDED);
  await expect(page.locator('#status')).toBeEmpty();
});

// Closing Try a ticket or the report ends a hold, and a hold's end redraws the bar: it must not forget a load.
test('Start stays off while the next run loads, even when Try a ticket is opened and closed meanwhile', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDesk(page);
  await start(page);
  await finishRun(page);
  const model = await holdModels(page);
  const toggle = page.locator('#toggle');
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await tryButton(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(toggle).toHaveText('Loading...');
  await expect(toggle).toBeDisabled();
  model.release();
  await expect(toggle).toHaveText('Stop');
  await expect(page.locator('#n-closed')).toHaveText(`0 of ${TICKETS_IN_A_RUN}`);
});

test('after a failed load, closing Try a ticket leaves Retry and the message on the bar', async ({ page }) => {
  test.setTimeout(120_000);
  await openDesk(page);
  await start(page);
  await finishRun(page);
  await page.route('**/models/*', (route) => route.abort());
  const toggle = page.locator('#toggle');
  await toggle.click();
  await expect(toggle).toHaveText('Retry');
  await expect(page.locator('#notice')).toHaveText(MODEL_FAILED);
  await tryButton(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(toggle).toHaveText('Retry');
  await expect(page.locator('#notice')).toHaveText(MODEL_FAILED);
  await page.unroute('**/models/*');
  await toggle.click();
  await expect(toggle).toHaveText('Stop');
});

test('a finished run ends on Start, and Start draws a new seed and resets every number', async ({ page }) => {
  test.setTimeout(120_000);
  await openDesk(page);
  await start(page);
  await expect(page.locator('body')).toHaveAttribute('data-seed', String(SEED));
  const toggle = page.locator('#toggle');
  for (let step = 0; step < MAX_RUN_STEPS && (await toggle.innerText()) !== 'Start'; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
  }
  await expect(toggle).toHaveText('Start');
  await expect(page.getByText(ENDED)).toBeVisible();
  await expect(page.locator('#sent-count')).toHaveText(String(TICKETS_IN_A_RUN));
  await expect(page.locator('#open-count')).toHaveText('0');
  await expect(page.locator('#n-closed')).toHaveText(`${TICKETS_IN_A_RUN} of ${TICKETS_IN_A_RUN}`);
  // An empty list at the end says so, so it does not look broken; it is not said mid-run.
  await expect(page.getByText('Nothing waiting.')).toBeVisible();
  const firstRun = await texts(page, '#sent-list .text');

  await start(page);
  await expect(page.getByText('Nothing waiting.')).toBeHidden();
  await expect(page.locator('body')).not.toHaveAttribute('data-seed', String(SEED));
  await expect(page.locator('#sent-count')).toHaveText('0');
  await expect(page.locator('#open-count')).toHaveText('0');
  await expect(page.locator('#n-closed')).toHaveText(`0 of ${TICKETS_IN_A_RUN}`);
  await expect(page.locator('#n-missed')).toHaveText('0');
  await expect(page.locator('#n-right')).toHaveText('0');
  await expect(page.locator('#n-changed')).toHaveText('0');
  await page.clock.runFor(60_000);
  // The tickets on screen are the new seed's, so the new seed is a real one and not just a label.
  const second = Number(await page.locator('body').getAttribute('data-seed'));
  const real = realTexts(second);
  const shown = await texts(page, '#sent-list .text');
  expect(shown.length).toBeGreaterThan(0);
  for (const text of shown) expect(real.has(text), text).toBe(true);
  expect(second).not.toBe(SEED);
  expect(firstRun.length).toBe(TICKETS_IN_A_RUN);
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test.describe(`reduced motion at ${viewport.width} wide`, () => {
    test.use({ viewport });

    test('nothing sticks out sideways and the bar controls do not overlap, at rest and in a run', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openDesk(page);
      const settled = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(await settled()).toBe(true);
      await expectBarClear(page);
      await start(page);
      await page.clock.runFor(90_000);
      expect(await settled()).toBe(true);
      await expectBarClear(page);
    });
  });
}

test.describe('at 1280 wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the lists scroll inside their columns and the page itself does not', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDesk(page);
    await start(page);
    await page.clock.runFor(120_000);
    // Scrolled for real: a list whose extra rows are only clipped has more content than room but cannot move.
    const scrolledTo = await page.locator('#sent-list').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return node.scrollTop;
    });
    expect(scrolledTo).toBeGreaterThan(0);
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    // Every ticket is in a list, not cut off at a few.
    expect(await sentRows(page).count()).toBeGreaterThan(20);
  });
});

async function expectBarClear(page: Page): Promise<void> {
  const boxes = await page
    .locator('#toggle, #status-wrap, #bar-links a')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  for (const [at, a] of boxes.entries()) {
    for (const b of boxes.slice(at + 1)) {
      const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart, `${JSON.stringify(a)} against ${JSON.stringify(b)}`).toBe(true);
    }
  }
}
