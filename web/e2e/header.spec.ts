import { expect, test, type Page } from '@playwright/test';
import { SLOW_STATUS, open, openLearn } from './helpers';

const SLOW_NOTICE = 'Slowed down for the first few tickets so you can follow along.';
const BUSY_NOTICE = 'Busy-day speed is back.';
const NOTICE_MS = 6000;
const SLOW_TICKETS_MS = 60_000;

const notice = (page: Page) => page.locator('#top-notice');
const purpose = (page: Page) => page.locator('#purpose');
const play = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });

// The line under the title: what the page is, or in See what the pace is doing. One line of the header, so
// the words change and the height does not.
test.describe('the line under the title', () => {
  test('keeps the purpose in Learn', async ({ page }) => {
    await openLearn(page);
    await expect(purpose(page)).toBeVisible();
    await expect(notice(page)).toBeHidden();
  });

  test('keeps the purpose in See while the run is at rest', async ({ page }) => {
    await open(page);
    await expect(purpose(page)).toBeVisible();
    await expect(notice(page)).toBeHidden();
  });

  test('says the run is slowed down while it plays slowly, announces nothing, and gives the purpose back on Pause', async ({ page }) => {
    await open(page);
    await play(page).click();
    await expect(notice(page)).toHaveText(SLOW_NOTICE);
    await expect(purpose(page)).toBeHidden();
    // The bar's status already says it; a second voice would say it twice.
    await expect(page.locator('#status')).toHaveText(SLOW_STATUS);
    await expect(notice(page)).not.toHaveAttribute('aria-live', /.+/);
    await expect(page.locator('#announcer')).not.toContainText('Slowed down');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(purpose(page)).toBeVisible();
    await expect(notice(page)).toBeHidden();
  });

  test('says it from the moment See opens, and not in Learn', async ({ page }) => {
    await openLearn(page);
    await page.getByRole('button', { name: 'See The Process' }).click();
    await expect(notice(page)).toHaveText(SLOW_NOTICE);
  });

  test('says busy-day speed is back for 6 seconds after Speed up, then gives the purpose back', async ({ page }) => {
    await open(page);
    await play(page).click();
    await page.getByRole('button', { name: 'Speed up', exact: true }).click();
    await expect(notice(page)).toHaveText(BUSY_NOTICE);
    await expect(purpose(page)).toBeHidden();
    await page.clock.runFor(NOTICE_MS - 100);
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText(BUSY_NOTICE);
    await page.clock.runFor(200);
    await expect(notice(page)).toBeHidden();
    await expect(purpose(page)).toBeVisible();
    await expect(page.locator('#announcer')).not.toContainText('Busy-day');
  });

  test('says it for 6 seconds after Play at the end of the slow part too, and Slow down brings the slow words back', async ({ page }) => {
    await open(page);
    await play(page).click();
    await page.clock.runFor(SLOW_TICKETS_MS + 1000);
    await expect(page.locator('#status')).toHaveText('That was the slow part. Press Speed up to see a busy day.');
    await expect(purpose(page)).toBeVisible();
    await play(page).click();
    await expect(notice(page)).toHaveText(BUSY_NOTICE);
    await page.clock.runFor(NOTICE_MS + 100);
    await expect(purpose(page)).toBeVisible();
    await page.getByRole('button', { name: 'Slow down', exact: true }).click();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText(SLOW_NOTICE);
  });

  test('does not start a busy-day notice when a restart goes back to the slow pace', async ({ page }) => {
    await open(page);
    await play(page).click();
    await page.getByRole('button', { name: 'Speed up', exact: true }).click();
    await expect(notice(page)).toHaveText(BUSY_NOTICE);
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(notice(page)).toBeHidden();
    await expect(purpose(page)).toBeVisible();
    await play(page).click();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText(SLOW_NOTICE);
  });

  test('wears a notice look: a border, a tint and the word Pace, not a color alone', async ({ page }) => {
    await open(page);
    await play(page).click();
    await expect(notice(page)).toBeVisible();
    const look = await notice(page).evaluate((node) => {
      const style = getComputedStyle(node);
      return { shadow: style.boxShadow, background: style.backgroundColor, word: getComputedStyle(node, '::before').content };
    });
    expect(look.shadow).not.toBe('none');
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(look.word).toContain('Pace');
  });
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('the notice takes no more height than the purpose line', async ({ page }) => {
      await open(page);
      const height = () => page.locator('.top').evaluate((node) => node.getBoundingClientRect().height);
      const purposeHeight = () => page.locator('.purpose').evaluate((node) => node.getBoundingClientRect().height);
      const [header, line] = [await height(), await purposeHeight()];
      await play(page).click();
      await expect(notice(page)).toBeVisible();
      expect(await height()).toBe(header);
      expect(await purposeHeight()).toBe(line);
      await page.getByRole('button', { name: 'Speed up', exact: true }).click();
      await expect(notice(page)).toHaveText(BUSY_NOTICE);
      expect(await height()).toBe(header);
    });
  });
}
