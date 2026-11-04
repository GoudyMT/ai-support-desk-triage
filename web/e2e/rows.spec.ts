import { expect, test, type Page } from '@playwright/test';
import {
  FAST_STATUS,
  FIRST_OPEN_MS,
  SEED,
  SLOW_STATUS,
  SLOW_TEST_MS,
  open,
  playToBusyDay,
  reviewButton,
  runPlaying,
  seeAndPause,
  stat,
  tabTo,
} from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

// Small rows, each pinning one thing a viewer sees or does, so a break in any of them goes red.
const REVIEWER_CLOSE_MS = 1_600;
const STEP_LIMIT = 40;
const LATE_PRESSES = 5000;
const DEEP_TICKETS_MS = 61_000;
const POLL_MS = 250;
const NARRATION_POLLS = 60;

async function playTo(page: Page, ms: number): Promise<void> {
  await open(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.clock.runFor(ms);
}

test.describe('by keyboard alone', () => {
  test('Pause, Step and Why this choice all work', async ({ page }) => {
    await open(page);
    await tabTo(page, 'Play');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText(SLOW_STATUS);
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Paused');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Step' })).toBeFocused();
    const stage = page.locator('#ticket .now-stage');
    for (let n = 0; n < STEP_LIMIT && (await stage.innerText().catch(() => '')) !== 'Now: Privacy'; n += 1) {
      await page.keyboard.press('Enter');
    }
    await expect(stage).toHaveText('Now: Privacy');
    await tabTo(page, 'Why this choice', true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Why this choice' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ticket .why-list')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('#ticket .why-list')).toBeHidden();
  });
});

test.describe('the measured real speed result', () => {
  test('pressed late on the real clock, it still times a pass over all 130 tickets', async ({ page }) => {
    await page.goto(`/?seed=${SEED}`);
    const real = page.getByRole('button', { name: /at real speed$/ });
    await expect(real).toBeVisible();
    // Step needs a paused run, so the page is taken from Learn to See and paused first.
    await seeAndPause(page);
    // Step is event by event and needs no time, so the run is taken nearly to its end in one go.
    await page.evaluate((limit) => {
      const step = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Step');
      const left = () => /last (\d+) tickets?/.exec(document.querySelector('.cta')?.textContent ?? '')?.[1] ?? '0';
      for (let n = 0; n < limit && Number(left()) > 3 && !step?.disabled; n += 1) step?.click();
    }, LATE_PRESSES);
    await expect(real).toHaveText(/last [1-3] tickets? at real speed/);
    await real.click();
    await expect(page.locator('#ticket')).toContainText(/130 tickets through every stage in [1-9]\d* ms, about [\d,]+ tickets a second\./);
  });
});

test.describe('the narration', () => {
  // What the viewer can see: the sentence that is drawn (the ticket's, or the idle line's when no ticket is in the center).
  const said = (page: Page) =>
    page.evaluate(() => ({
      shown: [...document.querySelectorAll<HTMLElement>('#ticket .say, #ticket .idle-say')].find((n) => n.getClientRects().length > 0)?.innerText ?? '',
      spoken: document.getElementById('announcer')?.textContent ?? '',
    }));

  test('is spoken exactly as shown: one sentence per later ticket held until the next, none on the busy day, always on Pause', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    // The first three tickets take 20 s each and are narrated at every stage; after them, one sentence each.
    await runPlaying(page, DEEP_TICKETS_MS);
    let held = 0;
    let own = 0;
    for (let n = 0; n < NARRATION_POLLS; n += 1) {
      await runPlaying(page, POLL_MS);
      const now = await said(page);
      expect(now.spoken).toBe(now.shown);
      // A later ticket's sentence is on screen for a quarter of a second per stage, so it stays up, with
      // its ticket id in front, until the next ticket's sentence replaces it.
      expect(now.shown).not.toBe('');
      if (/^T-1001-\d+: /.test(now.shown)) held += 1;
      else own += 1;
    }
    expect(held).toBeGreaterThan(3);
    expect(own).toBeGreaterThanOrEqual(2);

    await playToBusyDay(page);
    await expect(page.locator('#status')).toHaveText(FAST_STATUS);
    // No stage sentence on the busy day: the region says once that it has started, and nothing else.
    for (let n = 0; n < NARRATION_POLLS; n += 1) {
      await page.clock.runFor(POLL_MS);
      expect(await said(page)).toEqual({ shown: '', spoken: 'The busy day has started.' });
    }

    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await said(page);
    expect(paused.shown).not.toBe('');
    expect(paused.spoken).toBe(paused.shown);
  });
});

test.describe('forced colors', () => {
  test.use({ forcedColors: 'active' });

  // WebKit does not emulate forced colors, so there this only checks the dots keep a color of their own.
  test('the waiting dots still show against the page', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Step' }).click();
    const dot = page.locator('#ticket .dot').first();
    await expect(dot).toBeVisible();
    const [dotColor, pageColor] = await Promise.all([
      dot.evaluate((node) => getComputedStyle(node).backgroundColor),
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ]);
    expect(dotColor).not.toBe(pageColor);
  });
});

test.describe('Restart and Replay', () => {
  test('Restart starts a new run from the beginning with focus on Play', async ({ page }) => {
    await playTo(page, FIRST_OPEN_MS + REVIEWER_CLOSE_MS);
    await expect(stat(page, 'Tickets done')).not.toHaveText('0');
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(page.locator('#status')).toHaveText('Paused');
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await expect(page.locator('#incoming h2')).toHaveText('Coming in (0 waiting)');
    await expect(page.locator('#outgoing [data-ticket]')).toHaveCount(0);
    await expect(page.locator('#ticket .idle')).toHaveText('Press Play to see the next ticket.');
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
  });

  test('Replay at learn speed starts a new run playing, and drops the old result', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: /at real speed$/ }).click();
    await expect(page.locator('#status')).toHaveText('Run complete');
    await page.getByRole('button', { name: 'Replay at learn speed' }).click();
    await expect(page.locator('#status')).toHaveText(SLOW_STATUS);
    await expect(page.getByRole('heading', { name: 'Run complete at real speed' })).toBeHidden();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.clock.runFor(FIRST_OPEN_MS);
    await expect(reviewButton(page, 'T-1001-0')).toHaveCount(1);
  });
});
