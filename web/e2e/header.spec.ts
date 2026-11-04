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

const LEARN_STEPS = 7;
// Longer than the half second the hole takes to ease to the next lit part.
const EASE_WAIT_MS = 6000;
const VIEW_NOTE = 'Ready? Switch to See The Process to watch it run.';
const note = (page: Page) => page.locator('#view-note');
// The switch is 44 px tall inside its border, and it was 285 px wide before it was widened.
const SWITCH_HEIGHT_PX = 46;
const OLD_SWITCH_WIDTH_PX = 285;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const boxes = (page: Page, selectors: string[]) =>
  page.evaluate((list) => {
    const out: Record<string, { left: number; top: number; right: number; bottom: number } | null> = {};
    for (const selector of list) {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      out[selector] = box === undefined ? null : { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }
    return out;
  }, selectors);

const apart = (a: Box | null | undefined, b: Box | null | undefined): boolean =>
  a != null && b != null && (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

// The two views: a switch that is bigger to click by its width alone, and a note under it in Learn.
test.describe('the switch between the views', () => {
  test('is wider than it was and no taller', async ({ page }) => {
    await openLearn(page);
    const { '#views': views } = await boxes(page, ['#views']);
    expect((views?.right ?? 0) - (views?.left ?? 0)).toBeGreaterThanOrEqual(OLD_SWITCH_WIDTH_PX + 24);
    expect((views?.bottom ?? 0) - (views?.top ?? 0)).toBeLessThanOrEqual(SWITCH_HEIGHT_PX + 0.5);
    for (const id of ['view-learn', 'view-see']) {
      expect((await page.locator(`#${id}`).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('has a note under it in Learn only', async ({ page }) => {
    await openLearn(page);
    await expect(note(page)).toBeVisible();
    await expect(note(page)).toHaveText(VIEW_NOTE);
    await page.getByRole('button', { name: 'See The Process' }).click();
    await expect(note(page)).toBeHidden();
    await page.getByRole('button', { name: 'Learn The Process' }).click();
    await expect(note(page)).toBeVisible();
  });

  test('has a note on a solid background, above the dim layer', async ({ page }) => {
    await openLearn(page);
    const seen = await page.evaluate(() => {
      const node = document.getElementById('view-note');
      if (node === null) return null;
      const box = node.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { background: getComputedStyle(node).backgroundColor, onTop: top?.closest('#view-note') != null };
    });
    expect(seen?.onTop).toBe(true);
    expect(seen?.background).not.toBe('rgba(0, 0, 0, 0)');
  });
});

for (const viewport of [
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`the header at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('has its stats clear of the switch and the note, and the note adds no height', async ({ page }) => {
      await openLearn(page);
      const learn = await boxes(page, ['.top', '#views', '#view-note', '#stats', '#more-toggle']);
      for (const [name, clearOf] of [
        ['stats', learn['#stats']],
        ['All numbers', learn['#more-toggle']],
      ] as const) {
        expect(apart(learn['#views'], clearOf), `the switch and ${name}`).toBe(true);
        expect(apart(learn['#view-note'], clearOf), `the note and ${name}`).toBe(true);
      }
      await page.getByRole('button', { name: 'See The Process' }).click();
      const see = await boxes(page, ['.top', '#views', '#stats', '#more-toggle']);
      expect(apart(see['#views'], see['#stats'])).toBe(true);
      // The note hangs over the row below the switch, so the header is as tall with it as without.
      expect((learn['.top']?.bottom ?? 0) - (learn['.top']?.top ?? 0)).toBe((see['.top']?.bottom ?? 0) - (see['.top']?.top ?? 0));
    });

    test('keeps the Learn block off the note on every step', async ({ page }) => {
      await openLearn(page);
      for (let step = 0; step < LEARN_STEPS; step += 1) {
        if (step > 0) await page.getByRole('button', { name: 'Next', exact: true }).click();
        // Polled: the block follows the hole as it eases to the next lit part.
        await expect
          .poll(async () => {
            const seen = await boxes(page, ['.learn-block', '#view-note']);
            return apart(seen['.learn-block'], seen['#view-note']);
          }, { message: `step ${step + 1}`, timeout: EASE_WAIT_MS })
          .toBe(true);
      }
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the note sits in the flow under the switch, with no sideways scroll and 44 px buttons', async ({ page }) => {
    await openLearn(page);
    await expect(note(page)).toBeVisible();
    const { '#views': views, '#view-note': under } = await boxes(page, ['#views', '#view-note']);
    expect(under?.top ?? 0).toBeGreaterThanOrEqual(views?.bottom ?? 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const id of ['view-learn', 'view-see']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    }
  });
});
