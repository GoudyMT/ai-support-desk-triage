import { expect, test, type Page } from '@playwright/test';
import { FIRST_OPEN_MS, open, reviewButton } from './helpers';

// Small rows, each pinning one thing a viewer sees or does, so a break in any of them goes red.
const REVIEWER_CLOSE_MS = 1_600;

const stat = (page: Page, label: string) => page.locator('#stats > div', { hasText: label }).locator('dd');

async function playTo(page: Page, ms: number): Promise<void> {
  await open(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.clock.runFor(ms);
}

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
