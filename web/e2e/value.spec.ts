import { expect, test, type Page } from '@playwright/test';
import { open, playToFirstOpen, reviewButton } from './helpers';

const TIME_COPY =
  'Estimate, not a measurement. Each ticket the system sorted correctly with no review counts as 2 minutes saved. Vendors of IT desk tools put sorting one ticket at 3 to 12 minutes (Mizo, Giant Rocketship) and we found no independent study, so we use less than their lowest figure.';
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

  test('Value saved links to the Bureau of Labor Statistics and Time saved to the two vendors', async ({ page }) => {
    await openNumbers(page);
    await source(page, 'Value saved').click();
    const link = panel(page, 'Value saved').getByRole('link');
    await expect(link).toHaveText('Bureau of Labor Statistics, May 2025');
    await expect(link).toHaveAttribute('href', BLS_URL);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await source(page, 'Time saved').click();
    const vendors = panel(page, 'Time saved').getByRole('link');
    await expect(vendors).toHaveText(['Mizo', 'Giant Rocketship']);
    expect(await vendors.evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('href'), node.getAttribute('rel')]))).toEqual([
      ['https://mizo.tech/blog/ticket-triaging-practical-guide-msp/', 'noopener noreferrer'],
      ['https://giantrocketship.com/blog/the-5-minute-ticket-why-your-triage-process-costs-more-than-you-think', 'noopener noreferrer'],
    ]);
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

// The numbers rise only when a ticket that no person touched closes: one ticket, 2 minutes, at a time.
const MINUTES_PER_TICKET = 2;
const STEP_MS = 250;
const MAX_STEPS = 600;

const timeText = (page: Page) => row(page, 'Time saved').locator('.more-text');
const valueText = (page: Page) => row(page, 'Value saved').locator('.more-text');
const doneText = (page: Page) => page.locator('#stats > div', { hasText: 'Tickets done' }).locator('dd');

async function playOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
}

// One small step of the page's clock. The run waits for the viewer at the end of the slow part; carrying on is
// the viewer's press of Play.
async function tick(page: Page): Promise<void> {
  await page.clock.runFor(STEP_MS);
  const play = page.getByRole('button', { name: 'Play', exact: true });
  if (await play.isVisible()) await play.dispatchEvent('click');
}

// Runs the clock in small steps until Time saved reads something other than nothing.
async function runUntilSaved(page: Page): Promise<void> {
  for (let n = 0; n < MAX_STEPS && (await timeText(page).innerText()) === '0 min'; n += 1) await tick(page);
  expect(await timeText(page).innerText()).not.toBe('0 min');
}

test.describe('what the saved numbers count', () => {
  test('rise only when a ticket no person touched closes, by 2 minutes for each', async ({ page }) => {
    await openNumbers(page);
    await playOn(page);
    let sawTouched = false;
    let sawUntouched = false;
    let was = { done: 0, minutes: 0 };
    for (let n = 0; n < MAX_STEPS && !(sawTouched && sawUntouched); n += 1) {
      await tick(page);
      const now = { done: Number(await doneText(page).innerText()), minutes: Number.parseInt(await timeText(page).innerText(), 10) };
      if (now.minutes !== was.minutes) {
        // Every rise comes with a ticket closing, and counts that one ticket only.
        expect(now.done - was.done, `done at step ${n}`).toBe(1);
        expect(now.minutes - was.minutes, `minutes at step ${n}`).toBe(MINUTES_PER_TICKET);
        sawUntouched = true;
      } else if (now.done > was.done) {
        // A ticket a person looked at (here the simulated reviewer) closed and saved nothing.
        sawTouched = true;
      }
      was = now;
    }
    expect(sawTouched && sawUntouched).toBe(true);
    await expect(valueText(page)).toHaveText(`$${((was.minutes / 60) * 21.53).toFixed(2)}`);
  });

  test('add nothing when the viewer reviews a ticket', async ({ page }) => {
    await playToFirstOpen(page);
    await page.locator('#more-toggle').click();
    await expect(timeText(page)).toHaveText('0 min');
    await reviewButton(page, 'T-1001-0').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(doneText(page)).toHaveText('1');
    await expect(timeText(page)).toHaveText('0 min');
    await expect(valueText(page)).toHaveText('$0.00');
  });
});

interface Flash {
  row: string;
  bg: string;
  ink: string;
}

// Records every pulse the page starts on a number (the call to element.animate), so a test can tell a pulse
// that ran from one that did not, however short it lasts. Call it before the page loads.
async function watchFlashes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const flashes: { row: string; bg: string; ink: string }[] = [];
    Object.assign(window, { flashes });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      if (this.classList.contains('more-text')) {
        const first = Array.isArray(keyframes) ? keyframes[0] : undefined;
        flashes.push({
          row: this.closest('.more-row')?.querySelector('dt')?.textContent ?? '',
          bg: String(first?.backgroundColor),
          ink: String(first?.color),
        });
      }
      return animate.call(this, keyframes, options);
    };
  });
}

const flashes = (page: Page) => page.evaluate(() => (window as unknown as { flashes: Flash[] }).flashes);

// The three channels of a `#rrggbb` token or an `rgb(r, g, b)` color, 0 to 255.
function channels(color: string): number[] {
  if (color.startsWith('#')) return [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
  return (color.match(/\d+/g) ?? []).map(Number);
}

// WCAG contrast of two colors.
function contrast(a: string, b: string): number {
  const light = (color: string): number => {
    const [r = 0, g = 0, blue = 0] = channels(color).map((part) => part / 255);
    const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue);
  };
  const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const WHITE = [255, 255, 255];
const AA = 4.5;

test.describe('the pulse when a saved number goes up', () => {
  test('runs once on each number when it rises, and not on the first drawing', async ({ page }) => {
    await watchFlashes(page);
    await openNumbers(page);
    expect(await flashes(page)).toEqual([]);
    await playOn(page);
    await runUntilSaved(page);
    const seen = await flashes(page);
    expect(seen.map((flash) => flash.row)).toEqual(['Time saved', 'Value saved']);
    // Green for the value, a pale neutral for the time: told apart by color.
    expect(seen[0]?.bg).not.toBe(seen[1]?.bg);
  });

  test('does not run when Restart takes the numbers back to zero', async ({ page }) => {
    await watchFlashes(page);
    await openNumbers(page);
    await playOn(page);
    await runUntilSaved(page);
    const before = (await flashes(page)).length;
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect(timeText(page)).toHaveText('0 min');
    expect((await flashes(page)).length).toBe(before);
  });

  test('does not run when real speed lands the whole day in one drawing', async ({ page }) => {
    await watchFlashes(page);
    await openNumbers(page);
    await playOn(page);
    await runUntilSaved(page);
    const before = (await flashes(page)).length;
    const minutes = await timeText(page).innerText();
    await page.getByRole('button', { name: /^Run the last \d+ tickets at real speed$/ }).click();
    await expect(timeText(page)).not.toHaveText(minutes);
    expect((await flashes(page)).length).toBe(before);
  });

  // The run put away while Learn walks comes back with more than the fresh run showed; nobody watched it rise.
  test('does not run when the viewer comes back to See with the numbers they had', async ({ page }) => {
    await watchFlashes(page);
    await openNumbers(page);
    await playOn(page);
    await runUntilSaved(page);
    const before = (await flashes(page)).length;
    const minutes = await timeText(page).innerText();
    await page.getByRole('button', { name: 'Learn The Process', exact: true }).click();
    await expect(timeText(page)).toHaveText('0 min');
    await page.getByRole('button', { name: 'See The Process', exact: true }).first().click();
    await expect(timeText(page)).toHaveText(minutes);
    expect((await flashes(page)).length).toBe(before);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('the number still rises and nothing pulses', async ({ page }) => {
      await watchFlashes(page);
      await openNumbers(page);
      await playOn(page);
      await runUntilSaved(page);
      expect(await flashes(page)).toEqual([]);
    });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`in the ${scheme} theme`, () => {
      test.use({ colorScheme: scheme });

      test('keeps its text at AA on the colour, and shows against the page', async ({ page }) => {
        await watchFlashes(page);
        await openNumbers(page);
        await playOn(page);
        await runUntilSaved(page);
        const [time, value] = await flashes(page);
        expect(contrast(time?.bg ?? '', time?.ink ?? ''), `time ${time?.bg} ${time?.ink}`).toBeGreaterThanOrEqual(AA);
        expect(contrast(value?.bg ?? '', value?.ink ?? ''), `value ${value?.bg} ${value?.ink}`).toBeGreaterThanOrEqual(AA);
        const pageColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        for (const flash of [time, value]) {
          expect(contrast(flash?.bg ?? '', pageColor), `${flash?.row} against the page`).toBeGreaterThan(1.2);
        }
        // White is for the dark theme: on the light page it could not be seen.
        if (scheme === 'dark') expect(channels(time?.bg ?? '')).toEqual(WHITE);
        else expect(channels(time?.bg ?? '')).not.toEqual(WHITE);
      });
    });
  }
});
