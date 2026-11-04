import { expect, test, type Page } from '@playwright/test';
import { openLearn, playToFirstOpen, tabTo } from './helpers';
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

test.describe('keyboard focus in Learn', () => {
  // Back cannot be used on step 1, so pressing it there takes the key's own target away. Focus goes to the main
  // button of the row instead of to nowhere.
  test('moves from Back to the main button when Back is pressed into step 1', async ({ page }) => {
    await openLearn(page);
    // By keyboard all the way: Safari does not focus a button that was clicked.
    await tabTo(page, 'Next');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Step 2 of 7');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    const back = page.getByRole('button', { name: 'Back' });
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Step 1 of 7');
    await expect(back).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    // And the keyboard still works from there.
    await page.keyboard.press('Tab');
    await expect(next(page)).toBeFocused();
  });
});

// The bar is fixed over the bottom of the screen. A control the keyboard reaches near the bottom is scrolled into
// view, and must stop above the bar rather than behind it.
const MAX_TABS = 45;
// The stops above the bar before Tab reaches it: the numbers' buttons, the link, the center's button and the lists.
const MIN_STOPS = 5;

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 640 },
]) {
  test.describe(`at ${viewport.width} px wide and ${viewport.height} tall`, () => {
    test.use({ viewport });

    test('every control Tab reaches stops clear of the bar', async ({ page }) => {
      // A run with an open card, so the board has its buttons; then Pause, and the numbers open.
      await playToFirstOpen(page);
      await page.getByRole('button', { name: 'Pause' }).click();
      await page.getByRole('button', { name: 'All numbers' }).click();
      const hidden: string[] = [];
      const trace: (string | null)[] = [];
      let reached = 0;
      for (let n = 0; n < MAX_TABS; n += 1) {
        await page.keyboard.press('Tab');
        const seen = await page.evaluate(() => {
          const node = document.activeElement;
          const bar = document.getElementById('bar')?.getBoundingClientRect();
          if (!(node instanceof HTMLElement) || bar === undefined || node.closest('#bar') !== null || node === document.body) return null;
          const box = node.getBoundingClientRect();
          return { name: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? node.id, covered: box.bottom > bar.top + 0.5 && box.width > 0 };
        });
        trace.push(seen?.name ?? null);
        if (seen === null) continue;
        reached += 1;
        if (seen.covered) hidden.push(seen.name);
      }
      expect(reached, JSON.stringify(trace)).toBeGreaterThan(MIN_STOPS);
      expect(hidden).toEqual([]);
    });
  });
}

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
