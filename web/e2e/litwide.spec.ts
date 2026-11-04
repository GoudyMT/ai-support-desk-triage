import { expect, test, type Page } from '@playwright/test';
import { openLearn } from './helpers';
import { LIT, eachStep, litBox, zoomText } from './learnKit';

// The lit part, above the bar, on the wide layout, where the columns scroll inside themselves (and the board is
// pushed down when All numbers is open): the page scrolls it into view, inside the columns too.
async function litAboveBar(page: Page, at: number): Promise<void> {
  const box = await litBox(page, LIT[at] ?? '');
  expect(box.top, `step ${at + 1} lit top`).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom, `step ${at + 1} lit bottom over the bar`).toBeLessThanOrEqual(box.barTop + 0.5);
}

test.describe('the lit part on a wide screen', () => {
  test.describe('at 1024 by 600', () => {
    test.use({ viewport: { width: 1024, height: 600 } });

    test('is above the bar on every step', async ({ page }) => {
      await openLearn(page);
      await eachStep(page, (at) => litAboveBar(page, at));
    });
  });

  test.describe('at 1280 by 800 with the text at 150%', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('is above the bar on every step', async ({ page }) => {
      await zoomText(page, 150);
      await openLearn(page);
      await eachStep(page, (at) => litAboveBar(page, at));
    });
  });

  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`at ${viewport.width} by ${viewport.height} with All numbers open`, () => {
      test.use({ viewport });

      test('is above the bar on every step', async ({ page }) => {
        await openLearn(page);
        await page.getByRole('button', { name: 'See The Process' }).first().click();
        await page.locator('#more-toggle').click();
        await expect(page.locator('#numbers')).toBeVisible();
        await page.getByRole('button', { name: 'Learn The Process' }).click();
        await expect(page.locator('.learn-block')).toBeVisible();
        // The panel is not drawn behind the dim, where it would take the room the lit part needs, and is as it was in See.
        await expect(page.locator('#numbers')).toBeHidden();
        await eachStep(page, (at) => litAboveBar(page, at));
        await page.getByRole('button', { name: 'See The Process' }).nth(1).click();
        await expect(page.locator('#numbers')).toBeVisible();
      });
    });
  }
});
