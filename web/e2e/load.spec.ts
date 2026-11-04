import { expect, test } from '@playwright/test';
import { SEED, START } from './helpers';

const MODEL_PATIENCE_MS = 60_000;

test.describe('a model that never arrives', () => {
  // The page's own timer is the browser's fake clock here, so a minute passes at once.
  test('stops waiting after 60 seconds and offers Retry, which then works', async ({ page }) => {
    await page.route('**/models/*', () => undefined);
    await page.clock.install({ time: START });
    await page.goto(`/?seed=${SEED}`);
    await expect(page.locator('#loading')).toBeVisible();
    await page.clock.runFor(MODEL_PATIENCE_MS - 1000);
    await expect(page.getByText('The model could not be loaded.')).toBeHidden();
    await page.clock.runFor(2000);
    await expect(page.getByText('The model could not be loaded.')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    await page.unroute('**/models/*');
    await page.getByRole('button', { name: 'Retry' }).click();
    // Learn The Process opens first, so the bar shows its row.
    await expect(page.locator('#learn-controls')).toBeVisible();
  });
});
