import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_PATH,
  FAST_STATUS,
  FIRST_OPEN_MS,
  SEED,
  SLOW_TEST_MS,
  WHY_READY_MS,
  open,
  playToBusyDay,
  playUntilOpenCount,
  reviewButton,
  runPlaying,
} from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

// When the control a viewer was on goes away, is hidden or is disabled, focus must land on another
// control, never on the body: a keyboard or screen reader user would be thrown back to the top.
const REVIEWER_CLOSE_MS = 1_600;
const WALK_LIMIT = 600;
const PRESS_LIMIT = 200;

const state = (page: Page) =>
  page.evaluate(() => {
    const node = document.activeElement;
    return {
      onBody: node === document.body || node === null,
      tag: node?.tagName ?? '',
      label: node?.getAttribute('aria-label') ?? node?.textContent?.trim() ?? '',
      shown: node instanceof HTMLElement && node.getClientRects().length > 0 && !('disabled' in node && node.disabled),
    };
  });

// Plays until the real speed button says only a few tickets are left.
async function playToTheEnd(page: Page): Promise<void> {
  const real = page.getByRole('button', { name: /at real speed$/ });
  for (let n = 0; n < WALK_LIMIT && !/last [1-2] tickets?/.test(await real.innerText()); n += 1) {
    await runPlaying(page, 1000);
  }
  await expect(real).toHaveText(/last [1-2] tickets? at real speed/);
}

test.describe('focus never falls to the body', () => {
  test('when the reviewer closes the top open card while its Review button has focus', async ({ page }) => {
    await open(page);
    await playUntilOpenCount(page, 3);
    const top = page.locator('#outgoing .open > li').first().getByRole('button');
    const name = (await top.getAttribute('aria-label')) ?? '';
    await top.focus();
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    await expect(reviewButton(page, name.replace('Review ', ''))).toHaveCount(0);
    const now = await state(page);
    expect(now.onBody).toBe(false);
    expect(now.shown).toBe(true);
    expect(now.label).toMatch(/^Review T-/);
    expect(now.label).not.toBe(name);
  });

  test('when the only open card is closed under focus, it goes to the primary control', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(FIRST_OPEN_MS);
    await reviewButton(page, 'T-1001-0').focus();
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    await expect(reviewButton(page, 'T-1001-0')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  });

  test('when Why this choice is focused and the busy day starts', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(WHY_READY_MS);
    const why = page.getByRole('button', { name: 'Why this choice' });
    await why.focus();
    await playToBusyDay(page, 500);
    await expect(page.locator('#status')).toHaveText(FAST_STATUS);
    await expect(why).toBeHidden();
    const now = await state(page);
    expect(now.onBody).toBe(false);
    expect(now.shown).toBe(true);
    expect(now.tag).toBe('BUTTON');
  });

  test('when Pause is focused and the paced run completes', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    // Safari does not focus a button on a click, so focus is put on Pause the way a keyboard would.
    await page.getByRole('button', { name: 'Pause' }).focus();
    for (let n = 0; n < WALK_LIMIT && (await page.locator('#status').innerText()) !== 'Run complete'; n += 1) {
      await runPlaying(page, 1000);
    }
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(page.getByRole('button', { name: 'Restart' })).toBeFocused();
  });

  test('when Step is pressed on the last event', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await playToTheEnd(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Step' }).focus();
    for (let n = 0; n < PRESS_LIMIT && (await page.locator('#status').innerText()) !== 'Run complete'; n += 1) {
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(page.getByRole('button', { name: 'Restart' })).toBeFocused();
  });

  // Learn The Process opens first, so the main button of the bar is the Learn pause.
  test('when Retry succeeds, focus goes to the main button of the bar', async ({ page }) => {
    await page.route('**/models/*', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto(`${DEMO_PATH}?seed=${SEED}`);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
    await page.unroute('**/models/*');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  });

  test('but not when nothing had focus: the body stays the body', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.clock.runFor(FIRST_OPEN_MS);
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    expect((await state(page)).onBody).toBe(true);
  });
});

test.describe('a focus ring is drawn whole', () => {
  // The column scrolls, so it clips whatever is drawn past its edge: a ring outside the rail, which
  // fills the column's width, would lose its sides.
  test('the rail of the folded Going out column is not clipped by its column', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Collapse' }).focus();
    await page.keyboard.press('Enter');
    const rail = page.locator('#outgoing .rail');
    await expect(rail).toBeFocused();
    const room = await page.evaluate(() => {
      const node = document.querySelector('#outgoing .rail');
      const column = document.getElementById('outgoing')?.getBoundingClientRect();
      if (node === null || column === undefined) return Number.NaN;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      return Math.min(
        box.left - reach - column.left,
        column.right - (box.right + reach),
        box.top - reach - column.top,
        column.bottom - (box.bottom + reach),
      );
    });
    expect(room).toBeGreaterThanOrEqual(0);
  });
});

test.describe('the Coming in list, which scrolls', () => {
  // A keyboard user can only scroll a region they can focus.
  test('can be reached with the Tab key, and has a name', async ({ page }) => {
    await open(page);
    await expect(page.locator('#incoming')).toHaveAttribute('tabindex', '0');
    await expect(page.getByRole('region', { name: 'Coming in' })).toHaveCount(1);
    let reached = false;
    for (let n = 0; n < PRESS_LIMIT && !reached; n += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'incoming');
    }
    expect(reached).toBe(true);
  });
});

test.describe('while a review form is open', () => {
  test('the other Review buttons are disabled, and come back when it closes', async ({ page }) => {
    await open(page);
    await playUntilOpenCount(page, 3);
    const first = page.locator('#outgoing .open > li').first().getByRole('button');
    await first.click();
    const others = page.locator('#outgoing .open').getByRole('button');
    expect(await others.count()).toBeGreaterThanOrEqual(2);
    for (const button of await others.all()) await expect(button).toBeDisabled();
    await page.getByRole('button', { name: 'Hand back to the reviewer' }).click();
    for (const button of await others.all()) await expect(button).toBeEnabled();
  });
});

// A keyboard viewer who reviews card after card needs focus put where the work is each time.
test.describe('focus around the review form', () => {
  const heading = (page: Page) => page.getByRole('heading', { name: /^You are reviewing T-/ });

  test('goes to the form each time one opens, not only the first time', async ({ page }) => {
    await open(page);
    await playUntilOpenCount(page, 2);
    const first = page.locator('#outgoing .open > li').first().getByRole('button');
    await first.click();
    await expect(heading(page)).toBeFocused();
    await page.getByRole('button', { name: 'Hand back to the reviewer' }).click();
    await first.click();
    await expect(heading(page)).toBeFocused();
  });

  // With other cards still open, a Review button is the nearest control: Confirm must not leave focus there.
  test('Confirm hands focus to the primary control of the bar, though other cards are open', async ({ page }) => {
    await open(page);
    await playUntilOpenCount(page, 2);
    await page.locator('#outgoing .open > li').first().getByRole('button').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  });
});

// A control the keyboard reaches behind the fixed bar is scrolled up above it.
test.describe('a focused control and the bar', () => {
  test.use({ viewport: { width: 375, height: 500 } });

  test('scrolls a control that sits behind the bar up above it', async ({ page }) => {
    await open(page);
    const gap = await page.evaluate(() => {
      const barTop = document.getElementById('bar')?.getBoundingClientRect().top ?? 0;
      const bar = document.getElementById('bar');
      const target = [...document.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].find((node) => {
        const box = node.getBoundingClientRect();
        return !(bar?.contains(node) ?? true) && box.height > 0 && box.top >= 0 && box.bottom > barTop && box.height < barTop - 16;
      });
      if (target === undefined) return Number.NaN;
      target.focus({ preventScroll: true });
      return barTop - target.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});
