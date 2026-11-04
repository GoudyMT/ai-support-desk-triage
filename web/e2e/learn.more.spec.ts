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

// Every button of the bar shows its word beside its icon on a phone too. The bar grows taller to hold them.
const TARGET_PX = 44;
const barWords = (page: Page) =>
  page.evaluate((min) =>
    [...document.querySelectorAll<HTMLElement>('#bar button')]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const word = button.querySelector<HTMLElement>('.bar-word');
        const box = word?.getBoundingClientRect();
        const outer = button.getBoundingClientRect();
        return {
          name: button.textContent?.trim() ?? '',
          shown: word !== null && word !== undefined && (box?.width ?? 0) > 1 && getComputedStyle(word).clipPath === 'none',
          small: outer.width < min - 0.5 || outer.height < min - 0.5,
        };
      }), TARGET_PX);

test.describe('the bar on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('keeps the word of every button in Learn and in See, with 44 px targets and no sideways scroll', async ({ page }) => {
    await openLearn(page);
    const learn = await barWords(page);
    expect(learn.map((b) => b.name)).toEqual(['Back', 'Pause', 'Next']);
    await page.getByRole('button', { name: 'See The Process' }).first().click();
    await expect(page.locator('#controls')).toBeVisible();
    const see = await barWords(page);
    expect(see.map((b) => b.name)).toEqual(['Pause', 'Step', 'Restart', 'Speed up']);
    for (const button of [...learn, ...see]) {
      expect(button.shown, `${button.name} shows its word`).toBe(true);
      expect(button.small, `${button.name} is 44 px`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

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
