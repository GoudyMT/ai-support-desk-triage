import { expect, test, type Page } from '@playwright/test';
import { DEMO_PATH, SEED } from './helpers';

// Real time, no test clock: a card in flight is a real animation, and these rows ask what it does when the page
// moves under it. Opening All numbers pushes the board down by the height of the panel.
const SAMPLES = 15;
const SAMPLE_MS = 20;

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('a card in flight when All numbers opens', () => {
  test('does not land on the panel: no card is drawn over it', async ({ page }) => {
    await page.goto(`${DEMO_PATH}?seed=${SEED}`);
    await page.getByRole('button', { name: 'See The Process' }).click();
    await page.getByRole('button', { name: 'Speed up', exact: true }).click();
    // The busy day is moving cards all the time; open the panel at the moment one is travelling.
    await page.waitForFunction(() => document.querySelectorAll('.ghost').length > 0, undefined, { polling: 10 });
    await page.locator('#more-toggle').click();
    let over = 0;
    for (let n = 0; n < SAMPLES; n += 1) {
      over += await page.evaluate(() => {
        const panel = document.getElementById('numbers')?.getBoundingClientRect();
        if (panel === undefined) return 0;
        return [...document.querySelectorAll('.ghost')].filter((ghost) => {
          const box = ghost.getBoundingClientRect();
          return box.right > panel.left && box.left < panel.right && box.bottom > panel.top && box.top < panel.bottom;
        }).length;
      });
      await page.waitForTimeout(SAMPLE_MS);
    }
    expect(over).toBe(0);
  });
});

test.describe('a card in flight', () => {
  const FLIGHT_MIN_MS = 300;
  const FLIGHT_MAX_MS = 400;

  async function busyDay(page: Page): Promise<void> {
    await page.goto(`${DEMO_PATH}?seed=${SEED}`);
    await page.getByRole('button', { name: 'See The Process' }).click();
    await page.getByRole('button', { name: 'Speed up', exact: true }).click();
  }

  const startX = /translate\(([-\d.]+)px/;

  test('goes from the line toward the center in about 350 ms, with its id, and is hidden from a screen reader', async ({ page }) => {
    await busyDay(page);
    const handle = await page.waitForFunction(
      () => {
        const ghost = document.querySelector('.ghost[data-from="incoming"]');
        const animation = ghost?.getAnimations()[0];
        if (ghost === null || ghost === undefined || animation === undefined) return null;
        const effect = animation.effect as KeyframeEffect;
        return {
          id: ghost.getAttribute('data-moving'),
          label: ghost.querySelector('.ghost-id')?.textContent ?? '',
          duration: Number(effect.getTiming().duration),
          moves: effect.getKeyframes().map((frame) => String(frame.transform)),
          hidden: ghost.closest('[aria-hidden="true"]') !== null,
        };
      },
      undefined,
      { polling: 10 },
    );
    const seen = await handle.jsonValue();
    if (seen === null) throw new Error('test: no card was seen in flight');
    expect(seen.label).toBe(seen.id);
    expect(seen.duration).toBeGreaterThanOrEqual(FLIGHT_MIN_MS);
    expect(seen.duration).toBeLessThanOrEqual(FLIGHT_MAX_MS);
    expect(seen.hidden).toBe(true);
    // The line is the left column and the center the middle one: the card ends to the right of where it began.
    const [from, to] = seen.moves.map((move) => Number(startX.exec(move)?.[1]));
    expect(to).toBeGreaterThan(from ?? Number.NaN);
  });

  test('carries the tag or pill of the card it becomes', async ({ page }) => {
    await busyDay(page);
    const handle = await page.waitForFunction(
      () => {
        const ghost = document.querySelector('.ghost[data-to="closed"]');
        return ghost === null ? null : { parts: ghost.childElementCount };
      },
      undefined,
      { polling: 10 },
    );
    expect((await handle.jsonValue())?.parts ?? 0).toBeGreaterThan(1);
  });
});
