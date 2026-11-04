import { expect, test } from '@playwright/test';
import { SEED } from './helpers';

// Real time, no test clock: a card in flight is a real animation, and these rows ask what it does when the page
// moves under it. Opening All numbers pushes the board down by the height of the panel.
const SAMPLES = 15;
const SAMPLE_MS = 20;

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('a card in flight when All numbers opens', () => {
  test('does not land on the panel: no card is drawn over it', async ({ page }) => {
    await page.goto(`/?seed=${SEED}`);
    await page.getByRole('button', { name: 'See The Process' }).click();
    await page.getByRole('button', { name: 'Speed up', exact: true }).click();
    // The busy day is moving cards all the time; open the panel at the moment one is travelling.
    await page.waitForFunction(() => document.querySelectorAll('.ghost').length > 0, undefined, { polling: 10 });
    await page.locator('#more-toggle').click();
    let over = 0;
    for (let n = 0; n < SAMPLES; n += 1) {
      over += await page.evaluate(() => {
        const panel = document.getElementById('numbers')?.getBoundingClientRect();
        if (panel === undefined) return 0;
        return [...document.querySelectorAll('.ghost')].filter((ghost) => {
          const box = ghost.getBoundingClientRect();
          return box.right > panel.left && box.left < panel.right && box.bottom > panel.top && box.top < panel.bottom;
        }).length;
      });
      await page.waitForTimeout(SAMPLE_MS);
    }
    expect(over).toBe(0);
  });
});
