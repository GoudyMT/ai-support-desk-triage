import { expect, test, type Page } from '@playwright/test';
import { FAST_STATUS, SLOW_TEST_MS, open, playToBusyDay } from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

// On a phone or a tablet the tabs sit under the center, so anything that changes the center's height moves
// the tabs and the lists under them: the page used to jump about 93 times in 30 s of the busy day.
const WATCH_MS = 30_000;
const SAMPLE_MS = 250;
const POLL_STEP_MS = 5_000;

const tabsTop = (page: Page) =>
  page.evaluate(() => document.querySelector('[role="tablist"]')?.getBoundingClientRect().top ?? Number.NaN);

for (const [width, height, seed] of [
  [375, 812, 1001],
  [768, 1024, 1001],
  [375, 812, 1002],
  [768, 1024, 1002],
] as const) {
  test.describe(`at ${width} px, seed ${seed}`, () => {
    test.use({ viewport: { width, height } });

    test('the tabs stay where they are through 30 seconds of the busy day', async ({ page }) => {
      await open(page, `?seed=${seed}`);
      await page.getByRole('button', { name: 'Play' }).click();
      await playToBusyDay(page, POLL_STEP_MS);
      await expect(page.locator('#status')).toHaveText(FAST_STATUS);
      const tops: number[] = [await tabsTop(page)];
      for (let at = 0; at < WATCH_MS; at += SAMPLE_MS) {
        await page.clock.runFor(SAMPLE_MS);
        tops.push(await tabsTop(page));
      }
      const moves = tops.filter((top, i) => i > 0 && top !== tops[i - 1]).length;
      expect({ moves, spread: Math.max(...tops) - Math.min(...tops) }).toEqual({ moves: 0, spread: 0 });
    });
  });
}
