import { expect, test, type Page } from '@playwright/test';
import { FIRST_OPEN_MS, SEED, open, playUntilOpenCount, reviewButton } from './helpers';

// A card that travels between sections is a ghost in one fixed overlay layer. The real cards never
// move out of their lists, so these specs watch the layer: a ghost is added, then removed.
const REVIEWER_CLOSE_MS = 1_600;
const GHOST_GONE_MS = 5_000;
const SETTLE_MS = 600;
const SHIFT_RUN_MS = 3_000;
const WALK_STEPS = 30;

interface Ghost {
  id: string;
  from: string;
  to: string;
  gone: boolean;
}

// Records every ghost the page adds to or removes from the document, with where it went.
async function watchGhosts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: { id: string; from: string; to: string; gone: boolean; node: Node }[] = [];
    Object.assign(window, { seen });
    const isGhost = (node: Node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('ghost');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!isGhost(node)) continue;
          seen.push({
            id: node.getAttribute('data-moving') ?? '',
            from: node.getAttribute('data-from') ?? '',
            to: node.getAttribute('data-to') ?? '',
            gone: false,
            node,
          });
        }
        for (const node of record.removedNodes) {
          for (const entry of seen) if (entry.node === node) entry.gone = true;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function ghosts(page: Page): Promise<Ghost[]> {
  return page.evaluate(() =>
    (window as unknown as { seen: Ghost[] }).seen.map(({ id, from, to, gone }) => ({ id, from, to, gone })),
  );
}

const layerCount = (page: Page) => page.locator('.ghost-layer').evaluate((layer) => layer.childElementCount);

async function playTo(page: Page, ms: number): Promise<void> {
  await open(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.clock.runFor(ms);
}

test.describe('a card that changes sections travels there', () => {
  test('left to center: a ghost for the ticket that took the center, gone when it ends', async ({ page }) => {
    await watchGhosts(page);
    await playTo(page, FIRST_OPEN_MS);
    const title = await page.locator('#ticket .now .ticket-title').innerText();
    const id = title.replace('Ticket ', '');
    expect(await ghosts(page)).toContainEqual(expect.objectContaining({ id, from: 'incoming', to: 'center' }));
    await expect.poll(async () => (await ghosts(page)).every((ghost) => ghost.gone), { timeout: GHOST_GONE_MS }).toBe(true);
    expect(await layerCount(page)).toBe(0);
  });

  test('center to right, then open to closed: a ghost each time, all gone when they end', async ({ page }) => {
    await watchGhosts(page);
    await playTo(page, FIRST_OPEN_MS);
    expect(await ghosts(page)).toContainEqual(expect.objectContaining({ id: 'T-1001-0', from: 'center', to: 'open' }));
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    expect(await ghosts(page)).toContainEqual(expect.objectContaining({ id: 'T-1001-0', from: 'open', to: 'closed' }));
    await expect.poll(async () => (await ghosts(page)).every((ghost) => ghost.gone), { timeout: GHOST_GONE_MS }).toBe(true);
    expect(await layerCount(page)).toBe(0);
  });

  test('a ticket has at most one ghost at a time', async ({ page }) => {
    await watchGhosts(page);
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    for (let n = 0; n < WALK_STEPS; n += 1) {
      await page.clock.runFor(1000);
      const alive = (await ghosts(page)).filter((ghost) => !ghost.gone).map((ghost) => ghost.id);
      expect(new Set(alive).size).toBe(alive.length);
    }
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('makes no ghost and runs no animation through the same moves', async ({ page }) => {
    await watchGhosts(page);
    await playTo(page, FIRST_OPEN_MS);
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    expect(await ghosts(page)).toEqual([]);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await layerCount(page)).toBe(0);
  });

  test('takes effect when the setting changes in the middle of a run', async ({ page }) => {
    await watchGhosts(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await playTo(page, FIRST_OPEN_MS);
    const before = (await ghosts(page)).length;
    expect(before).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(SETTLE_MS);
    await page.clock.runFor(SHIFT_RUN_MS);
    expect((await ghosts(page)).length).toBe(before);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test.describe('the cases with no motion or no harm', () => {
  test('real speed makes no ghost and leaves the layer empty', async ({ page }) => {
    await watchGhosts(page);
    await playTo(page, FIRST_OPEN_MS);
    await expect.poll(async () => (await ghosts(page)).every((ghost) => ghost.gone), { timeout: GHOST_GONE_MS }).toBe(true);
    const before = (await ghosts(page)).length;
    await page.getByRole('button', { name: /at real speed$/ }).click();
    await expect(page.locator('#status')).toHaveText('Run complete');
    expect((await ghosts(page)).length).toBe(before);
    expect(await layerCount(page)).toBe(0);
  });

  test('a focused Review button keeps focus through moves and slides', async ({ page }) => {
    await watchGhosts(page);
    await open(page);
    await playUntilOpenCount(page, 3);
    const last = page.locator('#outgoing .open').getByRole('button').last();
    const name = await last.getAttribute('aria-label');
    await last.focus();
    const before = (await ghosts(page)).length;
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    await page.clock.runFor(SHIFT_RUN_MS - REVIEWER_CLOSE_MS);
    expect((await ghosts(page)).length).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(name);
    await expect(reviewButton(page, name?.replace('Review ', '') ?? '')).toBeFocused();
  });

  test.describe('at 375 px', () => {
    // Tall, so the center and the lists are all on screen and cards do travel: a move whose end is
    // off screen is skipped, which is correct but would leave nothing to measure.
    test.use({ viewport: { width: 375, height: 2400 } });

    test('a ghost never makes the page scroll sideways', async ({ page }) => {
      await watchGhosts(page);
      await open(page, `?seed=${SEED}`);
      await page.getByRole('button', { name: 'Play' }).click();
      for (let n = 0; n < WALK_STEPS; n += 1) {
        await page.clock.runFor(1000);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(fits).toBe(true);
      }
      expect((await ghosts(page)).length).toBeGreaterThan(0);
    });
  });
});
