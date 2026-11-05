import { expect, test, type Page } from '@playwright/test';
import { moreNumber, openLearn, playToFirstOpen, reviewButton, stat } from './helpers';

// Pressing Learn in See puts the viewer's run away, paused, and walks a fresh run; pressing See brings the run back and
// plays it. What the viewer did in it (their reviews, the numbers) is still there.
const SLOW_PART_MS = 61_000;
const OFFER = 'That was the slow part. Press Speed up to see a busy day.';

const learn = (page: Page) => page.getByRole('button', { name: 'Learn The Process', exact: true });
const see = (page: Page) => page.getByRole('button', { name: 'See The Process', exact: true }).first();

test.describe('the viewer\'s run when Learn is pressed in See', () => {
  test('is kept, with their review and the numbers, and plays again on See', async ({ page }) => {
    await playToFirstOpen(page);
    await reviewButton(page, 'T-1001-0').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(stat(page, 'Tickets done')).toHaveText('1');
    await page.locator('#more-toggle').click();
    await expect(moreNumber(page, 'Your reviews correct')).toHaveText(/^[01] of 1$/);
    const reviews = (await moreNumber(page, 'Your reviews correct').innerText()).trim();
    await page.locator('#more-toggle').click();

    await learn(page).click();
    await expect(page.locator('#learn-controls')).toBeVisible();
    // Learn walks a fresh run: nothing of the viewer's is in it.
    await expect(stat(page, 'Tickets done')).toHaveText('0');

    await see(page).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(stat(page, 'Tickets done')).toHaveText('1');
    await expect(page.locator('#outgoing .closed li[data-ticket="T-1001-0"] .pill')).toHaveText(/^You: (right|wrong)$/);
    await page.locator('#more-toggle').click();
    await expect(moreNumber(page, 'Your reviews correct')).toHaveText(reviews);
  });

  test('is kept at the offer, which shows again', async ({ page }) => {
    await openLearn(page);
    // See plays at once; the slow part ends and the run waits for the viewer.
    await see(page).click();
    await page.clock.runFor(SLOW_PART_MS);
    await expect(page.locator('#status')).toHaveText(OFFER);
    const done = await stat(page, 'Tickets done').innerText();
    await learn(page).click();
    await see(page).click();
    await expect(page.locator('#status')).toHaveText(OFFER);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(stat(page, 'Tickets done')).toHaveText(done);
  });

  test('is not brought back after Restart: Restart starts the run over, and that is what is kept', async ({ page }) => {
    await playToFirstOpen(page);
    await page.clock.runFor(2000);
    await expect(stat(page, 'Tickets done')).not.toHaveText('0');
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await learn(page).click();
    await see(page).click();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
  });
});
