import { expect, test, type Page } from '@playwright/test';
import { FAST_STATUS, FIRST_OPEN_MS, SLOW_TEST_MS, WHY_READY_MS, open, playToBusyDay, reviewButton, tabTo } from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

// What the page promises every viewer: visible focus, big targets, speech, tabs by arrow keys,
// the busy-day line, a dark theme, and its assumptions stated.
const TARGET_PX = 44;
const LIGHT_PAGE = 'rgb(255, 255, 255)';
const DARK_PAGE = 'rgb(16, 16, 18)';

// Every drawn button, tab and select under 44 px either way, as `name WxH`.
const smallTargets = (page: Page) =>
  page.evaluate((min) => {
    const controls = [...document.querySelectorAll<HTMLElement>('button, select, [role="tab"]')];
    return controls
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width < min - 0.5 || box.height < min - 0.5)
      .map(({ node, box }) => `${node.textContent?.trim() || node.id} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }, TARGET_PX);

test.describe('focus and targets', () => {
  test('a focused control has a visible ring', async ({ page }) => {
    await open(page);
    await tabTo(page, 'Play');
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBe('2px');
    expect(ring.color).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('every button and select is at least 44 px, with a review form open', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(WHY_READY_MS);
    await page.getByRole('button', { name: 'All numbers' }).click();
    await page.getByRole('button', { name: 'Why this choice' }).click();
    await page.clock.runFor(FIRST_OPEN_MS - WHY_READY_MS);
    await expect(reviewButton(page, 'T-1001-0')).toHaveCount(1);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole('button', { name: 'Collapse' }).click();
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole('button', { name: /^Show tickets going out/ }).click();
    await reviewButton(page, 'T-1001-0').click();
    expect(await smallTargets(page)).toEqual([]);
  });

  // Every state exists: the pointer over a button, and pressing it, each change its color. Color only,
  // so nothing moves. Reduced motion is asked for so that no fade is still running when it is read.
  test('a button changes color under the pointer and again when pressed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    for (const name of ['Step', 'Play', 'All numbers']) {
      const button = page.getByRole('button', { name, exact: true });
      await page.mouse.move(0, 0);
      const rest = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
      await button.hover();
      const hovered = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(hovered, `${name} hovered`).not.toBe(rest);
      await page.mouse.down();
      const pressed = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
      await page.mouse.up();
      expect(pressed, `${name} pressed`).not.toBe(hovered);
      expect(pressed, `${name} pressed`).not.toBe(rest);
    }
  });

  test('a disabled button does not react to the pointer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const step = page.getByRole('button', { name: 'Step', exact: true });
    await expect(step).toBeDisabled();
    const rest = await step.evaluate((node) => getComputedStyle(node).backgroundColor);
    await step.hover({ force: true });
    expect(await step.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(rest);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('the tabs are 44 px too, and arrow keys, Home and End move between them', async ({ page }) => {
      await open(page);
      expect(await smallTargets(page)).toEqual([]);
      const coming = page.getByRole('tab', { name: /Coming in/ });
      const going = page.getByRole('tab', { name: /Going out/ });
      await coming.focus();
      await page.keyboard.press('ArrowRight');
      await expect(going).toBeFocused();
      await expect(going).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#outgoing')).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await expect(coming).toBeFocused();
      await expect(page.locator('#incoming')).toBeVisible();
      await page.keyboard.press('End');
      await expect(going).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Home');
      await expect(coming).toHaveAttribute('aria-selected', 'true');
    });
  });
});

test.describe('what the page says and shows', () => {
  test('the live region is polite', async ({ page }) => {
    await open(page);
    await expect(page.locator('#announcer')).toHaveAttribute('aria-live', 'polite');
  });

  test('the busy day replaces Why this choice with a line, and Pause brings it back', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const why = page.getByRole('button', { name: 'Why this choice' });
    await playToBusyDay(page);
    await expect(page.locator('#status')).toHaveText(FAST_STATUS);
    await expect(page.getByText('Explanations are off on the busy day. Pause to read one.')).toBeVisible();
    await expect(why).toBeHidden();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(why).toBeVisible();
    await expect(page.getByText('Explanations are off on the busy day.')).toBeHidden();
  });

  test('the dark theme changes the page colors', async ({ page }) => {
    await open(page);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await background()).toBe(LIGHT_PAGE);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await background()).toBe(DARK_PAGE);
  });

  test('All numbers states the assumptions', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'All numbers' }).click();
    const notes = page.locator('#numbers .assumptions li');
    await expect(notes).toHaveText([
      'Assumed arrivals: 100 tickets in a business day shown as 90 seconds',
      'Assumed: the simulated reviewer closes one ticket every 1.5 seconds',
      'Assumed: the simulated reviewer is wrong 5% of the time',
      'Assumed: each ticket no person touched saves 2 minutes',
      "Assumed: a person's time is worth $21.53 an hour",
    ]);
  });
});
