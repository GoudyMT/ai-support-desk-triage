import { expect, test, type Page } from '@playwright/test';
import { openLearn } from './helpers';
import { LIT, eachStep, litBox, zoomText } from './learnKit';

// Learn on a small screen and at a large text size: the words stay reachable, the lit part stays on the screen above
// the bar, and what the viewer had open (All numbers) does not push it away. Each is held to every step.
const LIT_SHOWING_PX = 44; // a card's height

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

test.describe('the docked block, on a very small screen and at a large text size', () => {
  test.describe('at 320 by 256', () => {
    test.use({ viewport: { width: 320, height: 256 } });

    test('keeps its title and words reachable inside the screen on every step', async ({ page }) => {
      await openLearn(page);
      await eachStep(page, (at) => wordsReachable(page, at));
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
