import { expect, test, type Locator, type Page } from '@playwright/test';
import { LOAD_MS, SEED, START } from './helpers';

const PHONE = { width: 375, height: 812 };
const TARGET = 44;
const RUN_MS = 60_000;
// A press this soon after a card opens or closes is a double press and is ignored; this is a moment past that.
const SETTLE_MS = 450;

// Opens the desk with the clock under the test's control: nothing moves until `runFor`. Reduced motion is on, so every
// box and number read below is the settled one.
async function openDesk(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${SEED}`);
}

async function runDesk(page: Page, ms = RUN_MS): Promise<void> {
  await openDesk(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: LOAD_MS });
  await page.clock.runFor(ms);
}

const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name: new RegExp(`^${name} \\d+$`) });
const side = (page: Page): Locator => page.locator('aside.side');
const numbersButton = (page: Page): Locator => page.getByRole('button', { name: 'Numbers', exact: true });
const more = (page: Page): Locator => page.getByRole('button', { name: /^(More numbers and report|Fewer numbers)$/ });
const generate = (page: Page): Locator => page.getByRole('button', { name: 'Generate report' });
const report = (page: Page): Locator => page.locator('#report');
const dialog = (page: Page): Locator => page.getByRole('dialog');

const sideways = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'a box on the page').not.toBeNull();
  return box as Box;
}

const inside = (box: Box, view = PHONE): boolean =>
  box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;

const apart = (a: Box, b: Box): boolean =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

// The four buttons of a run: each at least a finger tall, on the screen, clear of the others, with the icon above the word.
async function expectRunBar(page: Page): Promise<void> {
  const controls = [
    page.getByRole('button', { name: 'Stop', exact: true }),
    page.getByRole('button', { name: 'Try a ticket', exact: true }),
    numbersButton(page),
    page.getByRole('link', { name: 'Under the Hood', exact: true }),
  ];
  const boxes: Box[] = [];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await boxOf(control);
    expect(box.height, await control.innerText()).toBeGreaterThanOrEqual(TARGET);
    expect(inside(box), JSON.stringify(box)).toBe(true);
    // Start and Stop is one button with both icons in it; only the one for its state shows.
    const icon = control.locator('svg:visible');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    const word = control.locator('span');
    expect((await boxOf(icon)).y + (await boxOf(icon)).height).toBeLessThanOrEqual((await boxOf(word)).y + 1);
    boxes.push(box);
  }
  for (const [at, a] of boxes.entries()) {
    for (const b of boxes.slice(at + 1)) expect(apart(a, b), `${JSON.stringify(a)} against ${JSON.stringify(b)}`).toBe(true);
  }
  // Model History is not on the bar during a run: it is in the Numbers panel.
  await expect(page.getByRole('link', { name: 'Model History' })).toHaveCount(0);
}

test.describe('on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('one list at a time: a tap or an arrow key picks it, and each tab carries its list count', async ({ page }) => {
    await runDesk(page);
    await expect(page.getByRole('tablist')).toBeVisible();
    const open = tab(page, 'Needs a person');
    const sent = tab(page, 'Sent to teams');
    await expect(open).toHaveAttribute('aria-selected', 'true');
    await expect(sent).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#open-list')).toBeVisible();
    await expect(page.locator('#sent-list')).toBeHidden();
    await sent.tap();
    await expect(sent).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#sent-list')).toBeVisible();
    await expect(page.locator('#open-list')).toBeHidden();
    // A touch does not always leave focus on the tab it pressed (Safari), so the keys start from a focus of their own.
    await sent.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#open-list')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(sent).toBeFocused();
    await expect(page.locator('#sent-list')).toBeVisible();
    const counts = async () => [await page.locator('#open-list > li').count(), await page.locator('#sent-list > li').count()];
    const [openNow = 0, sentNow = 0] = await counts();
    expect(sentNow).toBeGreaterThan(0);
    await expect(open).toHaveText(`Needs a person ${openNow}`);
    await expect(sent).toHaveText(`Sent to teams ${sentNow}`);
    await page.clock.runFor(RUN_MS);
    const [openLater = 0, sentLater = 0] = await counts();
    expect(sentLater).toBeGreaterThan(sentNow);
    await expect(open).toHaveText(`Needs a person ${openLater}`);
    await expect(sent).toHaveText(`Sent to teams ${sentLater}`);
  });

  test('the three numbers sit on top and follow the run', async ({ page }) => {
    await runDesk(page);
    const row = page.locator('.phone-stats');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Closed');
    await expect(row).toContainText('High-risk missed');
    await expect(row).toContainText('Right with no person');
    const closed = await page.locator('#sent-list > li').count();
    await expect(page.locator('#p-closed')).toHaveText(`${closed} of 130`);
    expect(closed).toBeGreaterThan(0);
  });

  test('a run has four buttons, and at rest the bar has Start, Model History and Under the Hood', async ({ page }) => {
    await openDesk(page);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Model History' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Under the Hood' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try a ticket', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Try a ticket yourself' })).toBeVisible();
    await expect(numbersButton(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: LOAD_MS });
    await page.clock.runFor(RUN_MS);
    await expectRunBar(page);
  });

  test('Numbers opens the panel over the list, the report opens from it and closes back to it, and Back returns to the list', async ({
    page,
  }) => {
    await runDesk(page);
    await numbersButton(page).tap();
    await expect(side(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This run' })).toBeFocused();
    await expect(page.locator('#open-list')).toBeHidden();
    await expect(page.getByRole('tablist')).toBeHidden();
    const panel = await boxOf(side(page));
    expect(panel.width).toBeGreaterThanOrEqual(PHONE.width - 40);
    expect(inside(panel)).toBe(true);
    await more(page).tap();
    await generate(page).tap();
    await expect(report(page)).toBeVisible();
    await expect(side(page)).toBeHidden();
    expect(inside(await boxOf(page.getByRole('button', { name: 'Close report' })))).toBe(true);
    await page.getByRole('button', { name: 'Close report' }).tap();
    await expect(report(page)).toBeHidden();
    await expect(side(page)).toBeVisible();
    await expect(generate(page)).toBeFocused();
    await page.getByRole('button', { name: 'Back to the tickets' }).tap();
    await expect(side(page)).toBeHidden();
    await expect(page.locator('#open-list')).toBeVisible();
    await expect(tab(page, 'Needs a person')).toBeFocused();
  });

  test('Numbers pressed over a report goes back to the panel, and Model History is a link at the end of the panel', async ({
    page,
    context,
  }) => {
    await runDesk(page);
    await numbersButton(page).tap();
    await more(page).tap();
    await generate(page).tap();
    await expect(report(page)).toBeVisible();
    await numbersButton(page).tap();
    await expect(report(page)).toBeHidden();
    await expect(side(page)).toBeVisible();
    const history = page.getByRole('link', { name: 'Model History' });
    await history.scrollIntoViewIfNeeded();
    await expect(history).toBeVisible();
    expect(inside(await boxOf(history))).toBe(true);
    // A run is going, so the page opens in a new tab and the run stays where it is.
    const opened = context.waitForEvent('page');
    await history.tap();
    await expect(await opened).toHaveURL(/\/model-history\.html$/);
    await expect(page).toHaveURL(/\/\?seed=/);
  });

  test('a review is finished by touch, and the card fits the screen', async ({ page }) => {
    await runDesk(page);
    await page.locator('#open-list button[aria-label^="Review "]').first().tap();
    await expect(dialog(page)).toBeVisible();
    const card = await boxOf(dialog(page));
    expect(inside(card), JSON.stringify(card)).toBe(true);
    expect(await sideways(page)).toBe(false);
    await page.clock.runFor(SETTLE_MS);
    await dialog(page).getByRole('button', { name: /^(Looks good, send it|Send with my changes)$/ }).tap();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#sent-list .how', { hasText: 'You reviewed' }).first()).toBeAttached();
  });

  // The second tap of a double tap on Send finds the card gone and the bar under its finger.
  test('a second tap right after Send does not open Try a ticket behind the card, and a tap a moment later does', async ({
    page,
  }) => {
    await runDesk(page);
    await page.locator('#open-list button[aria-label^="Review "]').first().tap();
    await expect(dialog(page)).toBeVisible();
    await page.clock.runFor(SETTLE_MS);
    await dialog(page).getByRole('button', { name: /^(Looks good, send it|Send with my changes)$/ }).tap();
    await expect(dialog(page)).toBeHidden();
    await page.getByRole('button', { name: 'Try a ticket', exact: true }).tap();
    await expect(dialog(page)).toBeHidden();
    await page.clock.runFor(SETTLE_MS);
    await page.getByRole('button', { name: 'Try a ticket', exact: true }).tap();
    await expect(dialog(page)).toBeVisible();
  });

  test('Try a ticket is finished by touch, and the form fits the screen', async ({ page }) => {
    await runDesk(page);
    await page.getByRole('button', { name: 'Try a ticket', exact: true }).tap();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('textbox').fill('My invoice shows the wrong price for the Crew plan. Please correct it.');
    await dialog(page).getByRole('button', { name: 'Sort this ticket' }).tap();
    await expect(dialog(page).locator('.try-result')).toBeVisible();
    const form = await boxOf(dialog(page));
    expect(inside(form), JSON.stringify(form)).toBe(true);
    expect(await sideways(page)).toBe(false);
    await dialog(page).getByRole('button', { name: 'Close' }).tap();
    await expect(dialog(page)).toBeHidden();
  });

  test('the page never scrolls sideways: at rest, in a run, in the panel, with the report and with a form open', async ({
    page,
  }) => {
    await openDesk(page);
    expect(await sideways(page), 'at rest').toBe(false);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: LOAD_MS });
    await page.clock.runFor(RUN_MS * 2);
    expect(await sideways(page), 'in a run').toBe(false);
    await tab(page, 'Sent to teams').tap();
    expect(await sideways(page), 'sent list').toBe(false);
    await numbersButton(page).tap();
    await more(page).tap();
    expect(await sideways(page), 'panel').toBe(false);
    await generate(page).tap();
    await expect(report(page)).toBeVisible();
    expect(await sideways(page), 'report').toBe(false);
    await numbersButton(page).tap();
    await page.getByRole('button', { name: 'Back to the tickets' }).tap();
    await page.getByRole('button', { name: 'Try a ticket', exact: true }).tap();
    await expect(dialog(page)).toBeVisible();
    expect(await sideways(page), 'form').toBe(false);
  });
});

// A phone's own font can run wider than the one these tests are read with; the style tag is a test's stand-in for it and
// the page's own policy would refuse it.
test.describe('on a phone with a wider font', () => {
  test.use({ viewport: PHONE, bypassCSP: true });

  test('the bar buttons stay a finger tall and apart, and nothing sticks out sideways, at rest and in a run', async ({
    page,
  }) => {
    await openDesk(page);
    await page.addStyleTag({ content: '* { font-family: "Courier New", monospace !important; letter-spacing: 0.04em; }' });
    expect(await sideways(page), 'at rest').toBe(false);
    expect((await boxOf(page.getByRole('button', { name: 'Start' }))).height).toBeGreaterThanOrEqual(TARGET);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: LOAD_MS });
    await page.clock.runFor(RUN_MS);
    expect(await sideways(page), 'in a run').toBe(false);
    await expectRunBar(page);
    for (const name of [/^Needs a person \d+$/, /^Sent to teams \d+$/]) {
      expect((await boxOf(page.getByRole('tab', { name }))).height).toBeGreaterThanOrEqual(TARGET);
    }
    await numbersButton(page).click();
    await more(page).click();
    expect(await sideways(page), 'panel').toBe(false);
  });
});

// Phone width on a screen too short for the whole desk (a phone on its side): the page scrolls, as a page does, and the
// bar stays within reach.
for (const { width, height } of [
  { width: 640, height: 400 },
  { width: 568, height: 320 },
  { width: 320, height: 256 },
]) {
  test.describe(`at ${width} by ${height}`, () => {
    test.use({ viewport: { width, height } });

    test('a card\'s Review button can be scrolled to and pressed, and the bar stays reachable', async ({ page }) => {
      await runDesk(page);
      await page.locator('#open-list button[aria-label^="Review "]').first().click({ timeout: 5000 });
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toBeHidden();
      // The run holds while the pointer or the keyboard is in the list; this row is about the bar, so both leave it first.
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(room, 'the page can scroll').toBeGreaterThan(0);
      const bar = await boxOf(page.locator('.bar'));
      expect(bar.y + bar.height, 'the bar is on the screen').toBeLessThanOrEqual(height);
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeInViewport();
    });
  });
}

test.describe('at a phone width and a screen tall enough for one screen', () => {
  test.use({ viewport: PHONE });

  test('the desk is still one screen: the list scrolls inside it and the page does not', async ({ page }) => {
    await runDesk(page, 120_000);
    const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(room).toBeLessThanOrEqual(0);
    const list = await page.locator('#open-list').evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(list).toBe(true);
  });
});

// A tablet is wider than a phone and narrower than three columns: the lists sit two across and the page scrolls, so the
// This run panel is at the top, where it can be seen, and not below every sent row.
test.describe('at 768 wide', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the This run panel sits above the two lists, and the page does not scroll sideways', async ({ page }) => {
    await runDesk(page, 120_000);
    const panel = await boxOf(side(page));
    const lists = await boxOf(page.locator('#open-col'));
    expect(panel.y + panel.height, JSON.stringify({ panel, lists })).toBeLessThanOrEqual(lists.y);
    expect(await sideways(page)).toBe(false);
  });
});

// The bar sticks to the bottom of a page that scrolls, so a control brought into view must come to rest above it.
test.describe('at 800 by 600', () => {
  test.use({ viewport: { width: 800, height: 600 } });

  test('a focused control is not left under the bar', async ({ page }) => {
    await runDesk(page, 120_000);
    const behind = await page.evaluate(() => {
      const bar = document.querySelector('.bar');
      const buttons = [...document.querySelectorAll<HTMLElement>('#open-list .buttons > button:last-child')];
      const found: string[] = [];
      if (bar === null) return ['no bar'];
      for (const button of buttons) {
        // Down to the bottom edge of the screen, under the bar, as a Tab arrives at a control below the fold.
        const top = button.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top - window.innerHeight + button.offsetHeight + 4);
        button.focus();
        if (button.getBoundingClientRect().bottom > bar.getBoundingClientRect().top) {
          found.push(button.getAttribute('aria-label') ?? '');
        }
      }
      return found;
    });
    expect(behind).toEqual([]);
  });
});

test.describe('in forced colors on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('the selected tab is marked by more than its weight, and a tip box has an edge', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await runDesk(page);
    await expect(tab(page, 'Needs a person')).toHaveCSS('outline-style', 'solid');
    await expect(tab(page, 'Sent to teams')).toHaveCSS('outline-style', 'none');
    await page.locator('.phone-head .tip').focus();
    const box = page.locator('[role="tooltip"]:not([hidden])');
    await expect(box).toHaveCount(1);
    await expect(box).toHaveCSS('border-top-style', 'solid');
    await expect(box).not.toHaveCSS('border-top-width', '0px');
  });
});

// The way on after a run names the button this screen has: the wide screen's More numbers and report is not on a phone.
test.describe('the end of a run on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('the bar sends the viewer to Numbers', async ({ page }) => {
    test.setTimeout(120_000);
    await runDesk(page, 0);
    const toggle = page.locator('#toggle');
    for (let step = 0; step < 60 && (await toggle.innerText()) !== 'Start'; step += 1) await page.clock.runFor(10_000);
    await expect(toggle).toHaveText('Start');
    await expect(page.locator('#notice')).toHaveText('All 130 tickets handled. Open Numbers, or press Start to run a new set.');
  });
});

// The Model History page shares the desk's look and its tips; these are the parts that are its own.
test.describe('the Model History page', () => {
  const HISTORY = '/model-history.html';
  const APPROVE_TIP = 'How many cards in a run reach 70% sure, so Approve shows. A surer model lights more of them.';

  test('at 768 wide the whole table fits its box, so no column is cut off', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(HISTORY);
    await expect(page.locator('#rows > tr')).toHaveCount(2);
    const fits = await page
      .getByRole('region', { name: 'History, newest first' })
      .evaluate((node) => node.scrollWidth <= node.clientWidth);
    expect(fits).toBe(true);
  });

  test('Cards with Approve per run has an info tip that says what the number means', async ({ page }) => {
    await page.goto(HISTORY);
    const block = page.locator('.block', { hasText: 'Cards with Approve per run' });
    await block.getByRole('button').focus();
    await expect(page.locator('[role="tooltip"]:not([hidden])')).toHaveText(APPROVE_TIP);
  });

  test('in forced colors a tip box has an edge', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(HISTORY);
    await page.locator('.block .tip').first().focus();
    const box = page.locator('[role="tooltip"]:not([hidden])');
    await expect(box).toHaveCSS('border-top-style', 'solid');
    await expect(box).not.toHaveCSS('border-top-width', '0px');
  });
});

for (const height of [800, 520]) {
  test.describe(`at 1280 wide and ${height} high`, () => {
    test.use({ viewport: { width: 1280, height } });

    test('the desk keeps its two lists and panel, with none of the phone parts, and the panel heading never clips', async ({
      page,
    }) => {
      await runDesk(page, 120_000);
      await expect(page.getByRole('tablist')).toBeHidden();
      await expect(numbersButton(page)).toBeHidden();
      await expect(page.locator('.phone-stats')).toBeHidden();
      await expect(page.locator('#open-list')).toBeVisible();
      await expect(page.locator('#sent-list')).toBeVisible();
      await more(page).click();
      await generate(page).click();
      await expect(report(page)).toBeVisible();
      const panel = side(page);
      // At the top, at the end and between: the heading and its button are whole, and the panel's edge does not touch them.
      for (const at of [0, 8, 16, 1000]) {
        await panel.evaluate((node, top) => {
          node.scrollTop = top;
        }, at);
        const edge = await boxOf(panel);
        for (const part of [page.getByRole('heading', { name: 'This run' }), more(page)]) {
          const box = await boxOf(part);
          expect(box.y - edge.y, `scrolled to ${at}`).toBeGreaterThanOrEqual(8);
          expect(box.y + box.height, `scrolled to ${at}`).toBeLessThanOrEqual(edge.y + edge.height);
        }
      }
    });
  });
}
