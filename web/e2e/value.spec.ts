import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

const TIME_COPY =
  'Estimate, not a measurement. Each ticket no person touched counts as 2 minutes saved. Tool vendors publish 2 to 12 minutes for sorting one ticket and we found no independent study, so we use the low end.';
const VALUE_COPY =
  'Estimate, not a measurement. Time saved x $21.53 an hour, the US median pay for customer service representatives (Bureau of Labor Statistics, May 2025). Benefits are not added, which keeps it low.';
const BLS_URL = 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm';

// The saved numbers live in All numbers, as its first two rows, each with a small button that shows where it comes from.
// Found by the label alone: the words of Value saved's panel mention Time saved too.
const row = (page: Page, label: string) =>
  page.locator('#numbers .more-row').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
const source = (page: Page, label: string) => row(page, label).getByRole('button');
const panel = (page: Page, label: string) => row(page, label).locator('.source-panel');

async function openNumbers(page: Page): Promise<void> {
  await open(page);
  await page.locator('#more-toggle').click();
  await expect(page.locator('#numbers')).toBeVisible();
}

test.describe('where the saved numbers come from', () => {
  test('are the first two rows of All numbers, with a button each, closed until asked', async ({ page }) => {
    await openNumbers(page);
    await expect(page.locator('#numbers .more-row dt').first()).toHaveText('Time saved');
    await expect(page.locator('#numbers .more-row dt').nth(1)).toHaveText('Value saved');
    for (const label of ['Time saved', 'Value saved']) {
      await expect(source(page, label)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(page, label)).toBeHidden();
    }
    // The other rows carry no button: only an estimate needs its source.
    await expect(page.locator('#numbers .more-row button')).toHaveCount(2);
  });

  test('open under the pointer and close when it leaves', async ({ page }) => {
    await openNumbers(page);
    for (const [label, copy] of [
      ['Time saved', TIME_COPY],
      ['Value saved', VALUE_COPY],
    ] as const) {
      await source(page, label).hover();
      await expect(source(page, label)).toHaveAttribute('aria-expanded', 'true');
      await expect(panel(page, label)).toHaveText(copy);
      await page.mouse.move(0, 400);
      await expect(panel(page, label)).toBeHidden();
      await expect(source(page, label)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('open on keyboard focus, close on Escape, and Enter opens again', async ({ page }) => {
    await openNumbers(page);
    await page.locator('#more-toggle').focus();
    await page.keyboard.press('Tab');
    await expect(source(page, 'Time saved')).toBeFocused();
    await expect(panel(page, 'Time saved')).toBeVisible();
    await expect(source(page, 'Time saved')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(panel(page, 'Time saved')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(panel(page, 'Time saved')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(panel(page, 'Time saved')).toBeHidden();
  });

  test('keep the panel open while the keyboard moves on to its link, and close it when focus leaves', async ({ page, browserName }) => {
    await openNumbers(page);
    await source(page, 'Value saved').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(panel(page, 'Value saved')).toBeVisible();
    // WebKit's Tab skips links unless the user turns that on in the browser's settings, so there the first
    // Tab already leaves the row; Chromium and Firefox cover the step onto the link.
    if (browserName !== 'webkit') {
      await page.keyboard.press('Tab');
      await expect(panel(page, 'Value saved').getByRole('link')).toBeFocused();
      await expect(panel(page, 'Value saved')).toBeVisible();
    }
    await page.keyboard.press('Tab');
    await expect(panel(page, 'Value saved')).toBeHidden();
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('open on a tap and close on the next', async ({ page }) => {
      await openNumbers(page);
      await source(page, 'Time saved').tap();
      await expect(panel(page, 'Time saved')).toBeVisible();
      await expect(source(page, 'Time saved')).toHaveAttribute('aria-expanded', 'true');
      await source(page, 'Time saved').tap();
      await expect(panel(page, 'Time saved')).toBeHidden();
    });

    test('close on a tap anywhere else', async ({ page }) => {
      await openNumbers(page);
      await source(page, 'Value saved').tap();
      await expect(panel(page, 'Value saved')).toBeVisible();
      await page.locator('h1').tap();
      await expect(panel(page, 'Value saved')).toBeHidden();
    });
  });

  test('Value saved links to the Bureau of Labor Statistics and Time saved has no link', async ({ page }) => {
    await openNumbers(page);
    await source(page, 'Value saved').click();
    const link = panel(page, 'Value saved').getByRole('link');
    await expect(link).toHaveText('Bureau of Labor Statistics, May 2025');
    await expect(link).toHaveAttribute('href', BLS_URL);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await source(page, 'Time saved').click();
    await expect(panel(page, 'Time saved').getByRole('link')).toHaveCount(0);
  });

  test('is plain, undimmed text on a solid panel', async ({ page }) => {
    await openNumbers(page);
    await source(page, 'Time saved').click();
    const look = await panel(page, 'Time saved').evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, background: style.backgroundColor };
    });
    expect(look.opacity).toBe('1');
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
  });
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('each source panel is inside the screen and pushes nothing', async ({ page }) => {
      await openNumbers(page);
      const boardTop = (await page.locator('#app').boundingBox())?.y ?? 0;
      for (const label of ['Time saved', 'Value saved']) {
        await source(page, label).click();
        const box = await panel(page, label).boundingBox();
        expect(box, label).not.toBeNull();
        expect(box?.x ?? -1, `${label} left edge`).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `${label} right edge`).toBeLessThanOrEqual(viewport.width);
        expect((await page.locator('#app').boundingBox())?.y, `${label} board`).toBe(boardTop);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await source(page, label).click();
      }
    });

    test('the buttons are 44 px', async ({ page }) => {
      await openNumbers(page);
      for (const label of ['Time saved', 'Value saved']) {
        const box = await source(page, label).boundingBox();
        expect(box?.width ?? 0, label).toBeGreaterThanOrEqual(43.5);
        expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(43.5);
      }
    });
  });
}
