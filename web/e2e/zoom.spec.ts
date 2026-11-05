import { expect, test, type Page } from '@playwright/test';
import { openLearn } from './helpers';
import { LIT, count, eachStep, litBox, next, zoomText } from './learnKit';

// Learn on a small screen and at a large text size: the words stay reachable, the lit part stays on the screen above
// the bar, and what the viewer had open (All numbers) does not push it away. Each is held to every step.
const LIT_SHOWING_PX = 44; // a card's height
const SETTLE_MS = 700; // the hole eases for half a second
const LIT_BREATHING_PX = 4; // the room the hole keeps round the lit part
const HOLE_TOLERANCE_PX = 2;

// The block's title and text can both be scrolled into its own box, and the box is on the screen above the bar.
async function wordsReachable(page: Page, at: number): Promise<void> {
  const seen = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('.learn-block');
    const bar = document.getElementById('bar')?.getBoundingClientRect();
    if (box === null || bar === undefined) return null;
    const title = box.querySelector('h2')?.getBoundingClientRect();
    const paragraphs = [...box.querySelectorAll<HTMLElement>('p')].filter((p) => p.getClientRects().length > 0);
    box.scrollTop = 0;
    const atTop = { title: box.querySelector('h2')?.getBoundingClientRect().top ?? 0, box: box.getBoundingClientRect().top };
    box.scrollTop = box.scrollHeight;
    const rect = box.getBoundingClientRect();
    const last = paragraphs.at(-1)?.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      barTop: bar.top,
      titleAtTop: atTop.title - atTop.box,
      lastBelow: (last?.bottom ?? 0) - rect.bottom,
      scrolls: getComputedStyle(box).overflowY === 'auto' || getComputedStyle(box).overflowY === 'scroll',
      hadTitle: title !== undefined,
    };
  });
  expect(seen, `step ${at + 1}`).not.toBeNull();
  expect(seen?.top ?? -1, `step ${at + 1} block top`).toBeGreaterThanOrEqual(-0.5);
  expect(seen?.bottom ?? 0, `step ${at + 1} block over the bar`).toBeLessThanOrEqual((seen?.barTop ?? 0) + 0.5);
  expect(seen?.scrolls, `step ${at + 1} block scrolls`).toBe(true);
  expect(seen?.titleAtTop ?? -1, `step ${at + 1} title reachable`).toBeGreaterThanOrEqual(-0.5);
  expect(seen?.lastBelow ?? 1, `step ${at + 1} last words reachable`).toBeLessThanOrEqual(0.5);
  // The block did not take the whole screen: a card's height of the lit part still shows above it.
  const lit = await litBox(page, LIT[at] ?? '');
  const showing = Math.min(lit.bottom, seen?.top ?? 0) - Math.max(lit.top, 0);
  expect(showing, `step ${at + 1} lit part above the block`).toBeGreaterThanOrEqual(Math.min(lit.bottom - lit.top, LIT_SHOWING_PX));
}

// On a phone the hole stops above the docked block and never starts above the screen, and the room kept under the
// page for the block is given back when Learn ends.
test.describe('the hole and the room on a phone', () => {
  test.use({ viewport: { width: 375, height: 560 } });

  test('the hole stays on the screen and above the block on every step, and the room goes in See', async ({ page }) => {
    await openLearn(page);
    await eachStep(page, async (at) => {
      const seen = await page.evaluate(() => {
        const hole = document.querySelector('.dim')?.getBoundingClientRect();
        const block = document.querySelector('.learn-block')?.getBoundingClientRect();
        return { top: hole?.top ?? Number.NaN, bottom: hole?.bottom ?? Number.NaN, blockTop: block?.top ?? Number.NaN };
      });
      expect(seen.top, `step ${at + 1} hole top`).toBeGreaterThanOrEqual(-0.5);
      expect(seen.bottom, `step ${at + 1} hole over the block`).toBeLessThanOrEqual(seen.blockTop + 0.5);
    });
    const room = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--block-h'));
    expect(parseFloat(await room())).toBeGreaterThan(0);
    await page.locator('#view-see').click();
    await expect(page.locator('.dim')).toBeHidden();
    expect(parseFloat(await room())).toBe(0);
  });
});

test.describe('the docked block, on a very small screen and at a large text size', () => {
  test.describe('at 320 by 256', () => {
    test.use({ viewport: { width: 320, height: 256 } });

    test('keeps its title and words reachable inside the screen on every step', async ({ page }) => {
      await openLearn(page);
      await eachStep(page, (at) => wordsReachable(page, at));
    });
  });

  // Words that run past the block are for a reader with a keyboard too: Tab reaches the block, and the arrow keys scroll it.
  test.describe('by keyboard at 320 by 256', () => {
    test.use({ viewport: { width: 320, height: 256 } });
    const LONG_STEP = 6;
    const MAX_STOPS = 12;
    const overflow = (page: Page) =>
      page.evaluate(() => {
        const box = document.querySelector<HTMLElement>('.learn-block');
        return (box?.scrollHeight ?? 0) - (box?.clientHeight ?? 0);
      });

    test('is reached by Tab, has a name from its title and scrolls with the arrow keys', async ({ page }) => {
      await openLearn(page);
      for (let n = 1; n < LONG_STEP; n += 1) await next(page).click();
      await expect(count(page)).toHaveText(`Step ${LONG_STEP} of 7`);
      expect(await overflow(page), 'the words run past the block').toBeGreaterThan(0);
      const title = (await page.locator('.learn-title').innerText()).trim();
      const stops: string[] = [];
      for (let n = 0; n < MAX_STOPS && !(await page.locator('.learn-block').evaluate((box) => box === document.activeElement)); n += 1) {
        await page.keyboard.press('Tab');
        stops.push(await page.evaluate(() => document.activeElement?.getAttribute('class') ?? document.activeElement?.tagName ?? ''));
      }
      await expect(page.locator('.learn-block'), `Tab stops: ${stops.join(', ')}`).toBeFocused();
      await expect(page.getByRole('region', { name: title })).toHaveCount(1);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => page.locator('.learn-block').evaluate((box) => box.scrollTop)).toBeGreaterThan(0);
    });

    test('opens at its top on each step, not where the last one was read to', async ({ page }) => {
      await openLearn(page);
      for (let n = 1; n < LONG_STEP; n += 1) await next(page).click();
      await page.locator('.learn-block').evaluate((box) => {
        box.scrollTop = box.scrollHeight;
      });
      expect(await page.locator('.learn-block').evaluate((box) => box.scrollTop)).toBeGreaterThan(0);
      await next(page).click();
      await expect(count(page)).toHaveText('Step 7 of 7');
      expect(await overflow(page), 'step 7 runs past the block too').toBeGreaterThan(0);
      expect(await page.locator('.learn-block').evaluate((box) => box.scrollTop)).toBe(0);
    });
  });

  test.describe('at 375 by 812 with the text at 200%', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('keeps its title and words reachable inside the screen on every step', async ({ page }) => {
      await zoomText(page, 200);
      await openLearn(page);
      await eachStep(page, (at) => wordsReachable(page, at));
    });
  });
});

// A phone turned on its side, a window made narrower or wider: the walk is laid out again as when a step is shown
// (the room under the page, the lit part scrolled to), so the hole is where the lit part is.
const THIRD_STEP = 3;

async function holeOnLit(page: Page, at: number, label: string): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
  const seen = await page.evaluate((selector) => {
    const hole = document.querySelector('.dim')?.getBoundingClientRect();
    const boxes = [...document.querySelectorAll(selector)].filter((n) => n.getClientRects().length > 0).map((n) => n.getBoundingClientRect());
    const bar = document.getElementById('bar')?.getBoundingClientRect();
    const block = document.querySelector('.learn-block')?.getBoundingClientRect();
    return {
      holeHeight: hole?.height ?? 0,
      holeTop: hole?.top ?? 0,
      litTop: Math.min(...boxes.map((b) => b.top)),
      litBottom: Math.max(...boxes.map((b) => b.bottom)),
      barTop: bar?.top ?? 0,
      blockTop: block?.top ?? 0,
      blockBottom: block?.bottom ?? 0,
      blockHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--block-h')) || 0,
    };
  }, LIT[at] ?? '');
  expect(seen.holeHeight, `${label}: the hole is there`).toBeGreaterThan(0);
  expect(seen.litTop, `${label}: lit top`).toBeGreaterThanOrEqual(-0.5);
  expect(seen.litBottom, `${label}: lit bottom over the bar`).toBeLessThanOrEqual(seen.barTop + 0.5);
  expect(Math.abs(seen.holeTop - (seen.litTop - LIT_BREATHING_PX)), `${label}: the hole at the lit part`).toBeLessThanOrEqual(HOLE_TOLERANCE_PX);
  expect(seen.blockTop, `${label}: block top`).toBeGreaterThanOrEqual(-0.5);
}

test.describe('the walk when the screen changes size', () => {
  async function toStepFour(page: Page): Promise<void> {
    await openLearn(page);
    for (let n = 0; n < THIRD_STEP; n += 1) await next(page).click();
    await expect(count(page)).toHaveText('Step 4 of 7');
  }

  test('lays the lit part out again when a window goes from wide to narrow and back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await toStepFour(page);
    await holeOnLit(page, THIRD_STEP, 'wide');
    await page.setViewportSize({ width: 375, height: 812 });
    await holeOnLit(page, THIRD_STEP, 'narrow');
    expect(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--block-h')))).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await holeOnLit(page, THIRD_STEP, 'wide again');
    expect(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--block-h')))).toBe(0);
  });

  // A phone's address bar slides away as the page is read, which changes the height and not the width. A reader who
  // has scrolled on must not be snapped back to the lit part each time.
  test('leaves the page where the reader scrolled it when only the height changes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await toStepFour(page);
    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(() => window.scrollBy(0, 2000));
    const before = await page.evaluate(() => Math.round(window.scrollY));
    const lit = await litBox(page, LIT[THIRD_STEP] ?? '');
    expect(lit.top, 'the lit part has been scrolled off the top').toBeLessThan(0);
    await page.setViewportSize({ width: 375, height: 740 });
    await page.waitForTimeout(SETTLE_MS);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(before);
  });

  test('lays it out again when a phone is turned on its side', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await toStepFour(page);
    await holeOnLit(page, THIRD_STEP, 'upright');
    await page.setViewportSize({ width: 812, height: 375 });
    await holeOnLit(page, THIRD_STEP, 'on its side');
    await page.setViewportSize({ width: 375, height: 812 });
    await holeOnLit(page, THIRD_STEP, 'upright again');
  });
});
