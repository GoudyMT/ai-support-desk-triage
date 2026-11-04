import { expect, test, type Page } from '@playwright/test';
import { FIRST_OPEN_MS, open, reviewButton, stat, tabTo } from './helpers';

// Small rows, each pinning one thing a viewer sees or does, so a break in any of them goes red.
const REVIEWER_CLOSE_MS = 1_600;
const STEP_LIMIT = 40;

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
    await expect(page.locator('#status')).toHaveText('Learning pace');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Paused');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Step' })).toBeFocused();
    const stage = page.locator('#ticket .now-stage');
    for (let n = 0; n < STEP_LIMIT && (await stage.innerText().catch(() => '')) !== 'Now: Privacy'; n += 1) {
      await page.keyboard.press('Enter');
    }
    await expect(stage).toHaveText('Now: Privacy');
    await tabTo(page, 'Why this choice');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Why this choice' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ticket .why-list')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('#ticket .why-list')).toBeHidden();
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
    await expect(page.locator('#status')).toHaveText('Learning pace');
    await expect(page.getByRole('heading', { name: 'Run complete at real speed' })).toBeHidden();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.clock.runFor(FIRST_OPEN_MS);
    await expect(reviewButton(page, 'T-1001-0')).toHaveCount(1);
  });
});
