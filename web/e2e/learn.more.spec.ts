import { expect, test, type Page } from '@playwright/test';
import { FAST_STATUS, open, openLearn, playToFirstOpen, playUntilOpenCount, reviewButton, tabTo } from './helpers';
import { block, count, next } from './learnKit';

// Step 1's words take seven seconds to read; this is a little over.
const READ_STEP_1_MS = 8_000;

// Long enough for a slow ticket to move from one stage to the next (five seconds), short of the end of step 7.
const STEP_7_LISTEN_MS = 5_500;

// Longer than the reviewer's 1.5 s to close a card, shorter than the nine seconds step 6's words take.
const STEP_6_WAIT_MS = 4_000;

// Step 6 is about the card that waits for a person. The simulated reviewer would close it 1.5 s after it joins
// Going out, long before the words are read, so it is held for the step and let go by step 7 and by See.
const walkedCard = async (page: Page) => {
  for (let n = 0; n < 5; n += 1) await next(page).click();
  const card = page.locator('#outgoing .open > li').first();
  await expect(card).toBeVisible();
  const id = (await card.getAttribute('data-ticket')) ?? '';
  return { open: page.locator(`#outgoing .open > li[data-ticket="${id}"]`), closed: page.locator(`#outgoing .closed li[data-ticket="${id}"]`) };
};

// Every button of the bar shows its word beside its icon on a phone too. The bar grows taller to hold them.
const TARGET_PX = 44;
const barWords = (page: Page) =>
  page.evaluate((min) =>
    [...document.querySelectorAll<HTMLElement>('#bar button')]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const word = button.querySelector<HTMLElement>('.bar-word');
        const box = word?.getBoundingClientRect();
        const outer = button.getBoundingClientRect();
        return {
          name: button.textContent?.trim() ?? '',
          shown: word !== null && word !== undefined && (box?.width ?? 0) > 1 && getComputedStyle(word).clipPath === 'none',
          small: outer.width < min - 0.5 || outer.height < min - 0.5,
        };
      }), TARGET_PX);

test.describe('the bar on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('keeps the word of every button in Learn and in See, with 44 px targets and no sideways scroll', async ({ page }) => {
    await openLearn(page);
    const learn = await barWords(page);
    expect(learn.map((b) => b.name)).toEqual(['Back', 'Pause', 'Next']);
    await page.getByRole('button', { name: 'See The Process' }).first().click();
    await expect(page.locator('#controls')).toBeVisible();
    const see = await barWords(page);
    expect(see.map((b) => b.name)).toEqual(['Pause', 'Step', 'Restart', 'Speed up']);
    for (const button of [...learn, ...see]) {
      expect(button.shown, `${button.name} shows its word`).toBe(true);
      expect(button.small, `${button.name} is 44 px`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('what a screen reader is told in Learn', () => {
  // Two voices at once cannot be followed: Learn speaks its steps, and the run's own sentences stay quiet. The
  // steps that hold the ticket keep the run from changing its sentence, so this listens on step 7, where nothing
  // is held and the live ticket moves on every five seconds.
  test('hears the step and not the run, on a step where the run moves', async ({ page }) => {
    await openLearn(page);
    for (let n = 0; n < 6; n += 1) await next(page).click();
    await expect(count(page)).toHaveText('Step 7 of 7');
    const heard = await page.locator('#announcer').innerText();
    const [title, text] = await block(page).locator('h2, p').allInnerTexts();
    expect(heard).toBe(`${title}. ${text}`);
    const sentence = () => page.locator('#ticket .say').innerText();
    const before = await sentence();
    await page.clock.runFor(STEP_7_LISTEN_MS);
    await expect(count(page)).toHaveText('Step 7 of 7');
    // The run did speak on screen, and the announcer held to the step.
    expect(await sentence()).not.toBe(before);
    expect(await page.locator('#announcer').innerText()).toBe(heard);
  });

  test('on steps 3, 4 and 5 is the step and the live ticket sentence together, as the block shows them', async ({ page }) => {
    await openLearn(page);
    for (let at = 1; at <= 4; at += 1) {
      await next(page).click();
      if (at === 1) continue;
      const shown = await block(page).locator('h2, p').allInnerTexts();
      const [title, text, line] = shown;
      expect(line, `step ${at + 1} shows the ticket's sentence`).toMatch(/^This ticket: ./);
      await expect(page.locator('#announcer')).toHaveText(`${title}. ${text} ${line}`);
    }
  });
});

// Back plays the walk again to where each step ended, so the ticket the viewer saw is the one that comes back. A step
// is read for seconds, in which the line fills and a Critical ticket can be tagged ahead of the first.
test.describe('going back in Learn', () => {
  const walkedTicket = (page: Page) => page.locator('#ticket .now-title').getAttribute('data-ticket');

  // Seeds 1017 and 1019 tag their second ticket Critical while step 1 is read, so it, not the first, is walked.
  for (const seed of [1001, 1017, 1019]) {
    test(`returns the ticket the walk had at step 3, after reading steps 1 and 2 (seed ${seed})`, async ({ page }) => {
      await openLearn(page, `?seed=${seed}`);
      // Read step 1 in full: the timer moves on to step 2 by itself.
      await page.clock.runFor(READ_STEP_1_MS);
      await expect(count(page)).toHaveText('Step 2 of 7');
      await next(page).click();
      await expect(count(page)).toHaveText('Step 3 of 7');
      const seen = await walkedTicket(page);
      await next(page).click();
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(count(page)).toHaveText('Step 3 of 7');
      expect(await walkedTicket(page)).toBe(seen);
      await expect(page.locator('#ticket .now-stage')).toHaveText('Now: Privacy');
    });
  }
});

// On the last step the Next button is called See The Process, which is longer. On a phone the row must hold it
// without the bar growing or the Pause button moving, or the button a viewer is about to press jumps away.
for (const width of [360, 375, 390]) {
  test.describe(`the bar on the last step at ${width} px`, () => {
    test.use({ viewport: { width, height: 812 } });

    test('is as tall as before and keeps Back and Pause where they were', async ({ page }) => {
      await openLearn(page);
      for (let n = 0; n < 5; n += 1) await next(page).click();
      const where = () =>
        page.evaluate(() => {
          const rect = (name: string) => {
            const button = [...document.querySelectorAll<HTMLElement>('#learn-controls button')].find((b) => b.textContent?.trim() === name);
            const box = button?.getBoundingClientRect();
            return box === undefined ? null : { x: box.x, y: box.y, w: box.width };
          };
          return { bar: document.getElementById('bar')?.getBoundingClientRect().height ?? 0, back: rect('Back'), pause: rect('Pause'), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        });
      await expect(count(page)).toHaveText('Step 6 of 7');
      const before = await where();
      await next(page).click();
      await expect(count(page)).toHaveText('Step 7 of 7');
      const after = await where();
      expect(after.bar).toBe(before.bar);
      expect(after.back).toEqual(before.back);
      expect(after.pause).toEqual(before.pause);
      expect(after.sideways).toBe(false);
    });
  });
}

test.describe('keyboard focus in Learn', () => {
  // Back cannot be used on step 1, so pressing it there takes the key's own target away. Focus goes to the main
  // button of the row instead of to nowhere.
  test('moves from Back to the main button when Back is pressed into step 1', async ({ page }) => {
    await openLearn(page);
    // By keyboard all the way: Safari does not focus a button that was clicked.
    await tabTo(page, 'Next');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Step 2 of 7');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    const back = page.getByRole('button', { name: 'Back' });
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Step 1 of 7');
    await expect(back).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    // And the keyboard still works from there.
    await page.keyboard.press('Tab');
    await expect(next(page)).toBeFocused();
  });
});

// The bar is fixed over the bottom of the screen. A control the keyboard reaches near the bottom is scrolled into
// view, and must stop above the bar rather than behind it.
const MAX_TABS = 45;
// The stops above the bar before Tab reaches it: the numbers' buttons, the link, the center's button and the lists.
const MIN_STOPS = 5;

test.describe('focus that is not on a control', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // Focus on the page itself (or on a list taller than the screen) is nothing to scroll to: the page stays at its top.
  test('leaves the page at the top when focus goes to the body', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);
  });
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 640 },
]) {
  test.describe(`at ${viewport.width} px wide and ${viewport.height} tall`, () => {
    test.use({ viewport });

    test('every control Tab reaches stops clear of the bar', async ({ page }) => {
      // A run with an open card, so the board has its buttons; then Pause, and the numbers open.
      await playToFirstOpen(page);
      await page.getByRole('button', { name: 'Pause' }).click();
      await page.getByRole('button', { name: 'All numbers' }).click();
      const hidden: string[] = [];
      const trace: (string | null)[] = [];
      let reached = 0;
      for (let n = 0; n < MAX_TABS; n += 1) {
        await page.keyboard.press('Tab');
        const seen = await page.evaluate(() => {
          const node = document.activeElement;
          const bar = document.getElementById('bar')?.getBoundingClientRect();
          if (!(node instanceof HTMLElement) || bar === undefined || node.closest('#bar') !== null || node === document.body) return null;
          const box = node.getBoundingClientRect();
          return { name: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? node.id, covered: box.bottom > bar.top + 0.5 && box.width > 0 };
        });
        trace.push(seen?.name ?? null);
        if (seen === null) continue;
        reached += 1;
        if (seen.covered) hidden.push(seen.name);
      }
      expect(reached, JSON.stringify(trace)).toBeGreaterThan(MIN_STOPS);
      expect(hidden).toEqual([]);
    });
  });
}

// A viewer who goes to Learn with the review form open takes the ticket off the form: it is back on the open list
// when they return, and a Speed up pressed under the form has become the busy day, not a false offer.
test.describe('leaving See with the review form open', () => {
  const learnButton = (page: Page) => page.getByRole('button', { name: 'Learn The Process', exact: true });
  const seeButton = (page: Page) => page.getByRole('button', { name: 'See The Process', exact: true }).first();
  const openFirstCard = async (page: Page, seed: number) => {
    await open(page, `?seed=${seed}`);
    await playUntilOpenCount(page, 1);
    const id = (await page.locator('#outgoing .open > li').first().getAttribute('data-ticket')) ?? '';
    await reviewButton(page, id).click();
    await expect(page.locator('#review')).toBeVisible();
    return id;
  };

  for (const seed of [1001, 1017]) {
    test(`plays the busy day, with no offer, after Speed up under the form (seed ${seed})`, async ({ page }) => {
      await openFirstCard(page, seed);
      await page.getByRole('button', { name: 'Speed up' }).click();
      await learnButton(page).click();
      await seeButton(page).click();
      await expect(page.locator('#status')).toHaveText(FAST_STATUS);
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    });
  }

  test('puts the ticket back on the open list, with no form open and focus on the bar\'s main button', async ({ page }) => {
    const id = await openFirstCard(page, 1001);
    await learnButton(page).click();
    await seeButton(page).click();
    await expect(page.locator('#review')).toBeHidden();
    await expect(reviewButton(page, id)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Restart' })).not.toBeFocused();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  });
});

test.describe('the reviewer in Learn', () => {
  test('is held through step 6 so the walked card stays in Going out, and step 7 lets it close', async ({ page }) => {
    await openLearn(page);
    const { open, closed } = await walkedCard(page);
    await page.clock.runFor(STEP_6_WAIT_MS);
    await expect(count(page)).toHaveText('Step 6 of 7');
    await expect(open).toBeVisible();
    await expect(closed).toHaveCount(0);
    await next(page).click();
    await expect(closed).toHaveCount(1);
  });

  test('is let go when See The Process is pressed in step 6', async ({ page }) => {
    await openLearn(page);
    const { closed } = await walkedCard(page);
    await page.getByRole('button', { name: 'See The Process' }).first().click();
    await page.clock.runFor(STEP_6_WAIT_MS);
    await expect(closed).toHaveCount(1);
  });
});
