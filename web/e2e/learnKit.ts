import type { Page } from '@playwright/test';

// The parts of Learn The Process that the learn specs look at.
export const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
export const block = (page: Page) => page.locator('.learn-block');
export const count = (page: Page) => page.locator('#learn-controls .bar-status');

// What each of the seven steps lights, as selectors.
const LINE = '.lines-detail > .line-detail:nth-child';
export const LIT = [
  '#incoming',
  '.now-head, .track, .ticket-text',
  `${LINE}(1)`,
  `${LINE}(2)`,
  `${LINE}(3)`,
  '#outgoing',
  '#stats',
];

const SETTLE_MS = 700;

// Visits every step; `check` looks at it once the hole has settled.
export async function eachStep(page: Page, check: (at: number) => Promise<void>): Promise<void> {
  for (let at = 0; at < LIT.length; at += 1) {
    if (at > 0) await next(page).click();
    // Real time: the hole eases for half a second and the clock under test does not drive that.
    await page.waitForTimeout(SETTLE_MS);
    await check(at);
  }
}

// The smallest box round the drawn parts of the page that match the selector, and the bar's top edge.
export const litBox = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const boxes = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).map((n) => n.getBoundingClientRect());
    return {
      top: Math.min(...boxes.map((b) => b.top)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
      barTop: document.getElementById('bar')?.getBoundingClientRect().top ?? 0,
    };
  }, selector);

// Text zoom from the first moment of the page: it is sized in rem, so the root's font size scales all of it, as a
// browser's text zoom does. Call it before the page loads.
export const zoomText = (page: Page, percent: number) =>
  page.addInitScript((p) => {
    document.documentElement.style.fontSize = `${p}%`;
  }, percent);
