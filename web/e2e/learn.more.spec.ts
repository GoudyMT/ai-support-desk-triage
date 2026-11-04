import { expect, test, type Page } from '@playwright/test';
import { openLearn } from './helpers';
import { count, next } from './learnKit';

// Longer than the reviewer's 1.5 s to close a card, shorter than the nine seconds step 6's words take.
const STEP_6_WAIT_MS = 4_000;

// Step 6 is about the card that waits for a person. The simulated reviewer would close it 1.5 s after it joins
// Going out, long before the words are read, so it is held for the step and let go by step 7 and by See.
const walkedCard = async (page: Page) => {
  for (let n = 0; n < 5; n += 1) await next(page).click();
  const card = page.locator('#outgoing .open > li').first();
  await expect(card).toBeVisible();
  const id = (await card.getAttribute('data-ticket')) ?? '';
  return { open: page.locator(`#outgoing .open > li[data-ticket="${id}"]`), closed: page.locator(`#outgoing .closed li[data-ticket="${id}"]`) };
};

test.describe('the reviewer in Learn', () => {
  test('is held through step 6 so the walked card stays in Going out, and step 7 lets it close', async ({ page }) => {
    await openLearn(page);
    const { open, closed } = await walkedCard(page);
    await page.clock.runFor(STEP_6_WAIT_MS);
    await expect(count(page)).toHaveText('Step 6 of 7');
    await expect(open).toBeVisible();
    await expect(closed).toHaveCount(0);
    await next(page).click();
    await expect(closed).toHaveCount(1);
  });

  test('is let go when See The Process is pressed in step 6', async ({ page }) => {
    await openLearn(page);
    const { closed } = await walkedCard(page);
    await page.getByRole('button', { name: 'See The Process' }).first().click();
    await page.clock.runFor(STEP_6_WAIT_MS);
    await expect(closed).toHaveCount(1);
  });
});
