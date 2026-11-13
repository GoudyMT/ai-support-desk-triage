// Rows for what a person does on the desk that no other row would notice going wrong: the report's numbers in the right
// cells, a card opening at its own picks, where focus lands, where an info tip stands, and the phone's tabs. Each reads
// the page as a person does and takes its right answers from the same run in Node, never from numbers typed here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTES, type Category } from '../src/domain/labels';
import { percent } from '../src/desk/view';
import { loadModel } from '../src/model/scorer';
import { computeMetrics } from '../src/pipeline/metrics';
import { createDeskRun, deskTickets, scoreDesk, suggestFrom } from '../src/desk/deskRun';
import { DESK_WORDING } from '../src/generator/deskFrames';
import { webModel } from '../scripts/recordWebAnswers';
import { LOAD_MS, SEED, START } from './helpers';

const WIDE = { width: 1280, height: 800 };
const SHORT = { width: 1280, height: 520 };
const NARROWER = { width: 900, height: 800 };
const PHONE = { width: 375, height: 812 };
const STEP_MS = 250;
const MAX_STEPS = 400;
const RUN_MS = 60_000;
const RUN_STEP_MS = 10_000;
const MAX_RUN_STEPS = 60;
// A seed whose finished run has a high-risk ticket that got past review, so that number is not zero.
const MISSED_SEED = 1003;
// A seed whose finished run has six different shares in the report table, so a swap of two cells shows (found by search).
const REPORT_SEED = 1002;
// The card ignores a press for a moment after it opens; a person takes longer than that to read it.
const A_PERSONS_PAUSE_MS = 450;
const NOTE = 'Zephyr9 call them first';

// Opens the desk with the clock under the test's control: nothing moves until `runFor`. Reduced motion is on, so every
// box and number read below is the settled one.
async function openDesk(page: Page, seed = SEED): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${seed}`);
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: LOAD_MS });
}

async function runDesk(page: Page, ms = RUN_MS, seed = SEED): Promise<void> {
  await openDesk(page, seed);
  await start(page);
  await page.clock.runFor(ms);
}

async function finishRun(page: Page): Promise<void> {
  const toggle = page.locator('#toggle');
  for (let step = 0; step < MAX_RUN_STEPS && (await toggle.innerText()) !== 'Start'; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
  }
  await expect(toggle).toHaveText('Start');
}

// A changed number fades out and then in on the browser's own clock, not the test's, so its text is final only once the
// animations are over.
async function fadesDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
    .toBe(0);
}

const textOf = async (page: Page, selector: string): Promise<string> => (await page.locator(selector).textContent()) ?? '';

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

const cards = (page: Page): Locator => page.locator('#open-list > li');
const reviewOf = (card: Locator): Locator => card.getByRole('button', { name: /^Review/ });
const approveOf = (card: Locator): Locator => card.getByRole('button', { name: /^Approve/ });
const dialog = (page: Page): Locator => page.getByRole('dialog');
const field = (page: Page, label: string): Locator => dialog(page).getByLabel(label, { exact: true });
const noteBox = (page: Page): Locator => dialog(page).getByLabel('Note for the team (optional)');
const sendButton = (page: Page): Locator =>
  dialog(page).getByRole('button', { name: /^(Looks good, send it|Send with my changes)$/ });
const more = (page: Page): Locator => page.getByRole('button', { name: /^(More numbers and report|Fewer numbers)$/ });
const generate = (page: Page): Locator => page.getByRole('button', { name: 'Generate report' });
const report = (page: Page): Locator => page.locator('#report');
const side = (page: Page): Locator => page.locator('aside.side');
const numbersButton = (page: Page): Locator => page.getByRole('button', { name: 'Numbers', exact: true });
const tip = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true });
const tooltip = (page: Page): Locator => page.getByRole('tooltip');
const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name: new RegExp(`^${name} \\d+$`) });

// Lets the run go on until the open list holds `count` cards.
async function runUntilCards(page: Page, count: number): Promise<void> {
  for (let step = 0; step < MAX_STEPS && (await cards(page).count()) < count; step += 1) await page.clock.runFor(STEP_MS);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(count);
}

async function runUntilApprove(page: Page): Promise<Locator> {
  const card = cards(page).filter({ has: page.getByRole('button', { name: /^Approve/ }) });
  for (let step = 0; step < MAX_STEPS && (await card.count()) === 0; step += 1) await page.clock.runFor(STEP_MS);
  await expect(card.first()).toBeVisible();
  return card.first();
}

// A press within 400 ms of the card opening or closing is dropped on purpose, so these rows move at a person's pace.
async function aPersonsPause(page: Page): Promise<void> {
  await page.clock.runFor(A_PERSONS_PAUSE_MS);
  await page.waitForTimeout(A_PERSONS_PAUSE_MS);
}

async function openReview(page: Page, card: Locator): Promise<void> {
  await reviewOf(card).click();
  await expect(dialog(page)).toBeVisible();
  await aPersonsPause(page);
}

// The same run in Node: the page's run with no viewer, on the shipped word model and the sentence model's answers from
// the web engine, ends on the same closed tickets, so these are the numbers its report must show.
async function ownRun(seed = SEED) {
  const file = fileURLToPath(new URL('../src/model/model.json', import.meta.url));
  const model = loadModel(JSON.parse(readFileSync(file, 'utf8')));
  const answers = await scoreDesk(await webModel(), deskTickets(seed, DESK_WORDING));
  const run = createDeskRun({ seed, wording: DESK_WORDING, model, suggest: suggestFrom(answers), wallClock: () => 0, closeEveryMs: 2500 });
  run.finishNow();
  return run;
}

test.describe('the report of a finished run', () => {
  test.use({ viewport: WIDE });

  async function finishedReport(page: Page): Promise<void> {
    test.setTimeout(120_000);
    await openDesk(page, REPORT_SEED);
    await start(page);
    await finishRun(page);
    await fadesDone(page);
    await more(page).click();
    await generate(page).click();
    await expect(report(page)).toBeVisible();
  }

  test('the table shows each right-answer share under its own row and column', async ({ page }) => {
    await finishedReport(page);
    const run = await ownRun(REPORT_SEED);
    const m = computeMetrics(run.state().done, run.truthOf);
    const expected = {
      Category: [percent(m.v0.category), percent(m.categoryAccuracy.model), percent(m.categoryAccuracy.system)],
      Priority: [percent(m.v0.priority), percent(m.priorityAccuracy.model), percent(m.priorityAccuracy.system)],
    };
    // The shares differ from one another, or a swap of two of them could not be seen.
    expect(new Set([...expected.Category, ...expected.Priority]).size).toBe(6);
    for (const [row, cells] of Object.entries(expected)) {
      const line = page.locator('#report-table tbody tr').filter({ has: page.getByRole('rowheader', { name: row, exact: true }) });
      await expect(line.locator('td'), row).toHaveText(cells);
    }
  });

  test('the misses list shows each missed ticket masked, with what it said, what it truly was and the words that misled it', async ({
    page,
  }) => {
    await finishedReport(page);
    const run = await ownRun(REPORT_SEED);
    const { done } = run.state();
    const misses = computeMetrics(done, run.truthOf).instructiveMisses;
    expect(misses.length).toBeGreaterThan(0);
    const items = page.locator('#report-misses > li');
    await expect(items).toHaveCount(misses.length);
    for (const [at, miss] of misses.entries()) {
      const item = items.nth(at);
      await expect(item.locator('.text')).toHaveText(done.find((trail) => trail.id === miss.id)?.maskedText ?? 'no such ticket');
      const words = miss.topTerms.map((term) => term.term).join(', ');
      await expect(item.locator('.lean')).toHaveText(`Said ${miss.predicted}, truly ${miss.truth}. Words that misled it: ${words}`);
    }
  });
});

test.describe('a note and the report', () => {
  test.use({ viewport: WIDE });

  test('a note the viewer wrote never shows in the report', async ({ page }) => {
    await runDesk(page, 0);
    await runUntilCards(page, 1);
    await openReview(page, cards(page).first());
    await noteBox(page).fill(NOTE);
    await sendButton(page).click();
    await expect(page.locator('#sent-list .your-note')).toHaveText(`Your note: ${NOTE}`);
    await aPersonsPause(page);
    await more(page).click();
    await generate(page).click();
    await expect(report(page)).toBeVisible();
    await expect(report(page)).not.toContainText(NOTE);
    await expect(page.locator('#report-title')).toHaveText(/^After action report so far: \d+ of 130 tickets$/);
  });

  test('Close report with the panel folded away puts focus on More numbers', async ({ page }) => {
    await runDesk(page);
    await more(page).click();
    await generate(page).click();
    await expect(report(page)).toBeVisible();
    await more(page).click();
    await expect(generate(page)).toBeHidden();
    await page.getByRole('button', { name: 'Close report' }).click();
    await expect(report(page)).toBeHidden();
    await expect(more(page)).toBeFocused();
  });
});

test.describe('review cards and Approve', () => {
  test.use({ viewport: WIDE });

  test('Hand back returns the ticket to the open list and the run goes on', async ({ page }) => {
    await runDesk(page, 0);
    await runUntilCards(page, 1);
    const card = cards(page).first();
    const id = (await card.getAttribute('data-ticket')) ?? '';
    const waiting = await cards(page).count();
    await openReview(page, card);
    await dialog(page).getByRole('button', { name: 'Hand back to the reviewer' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator(`#open-list > li[data-ticket="${id}"]`)).toHaveCount(1);
    await expect(cards(page)).toHaveCount(waiting);
    await fadesDone(page);
    const closed = await textOf(page, '#n-closed');
    await page.clock.runFor(RUN_MS);
    await fadesDone(page);
    expect(await textOf(page, '#n-closed')).not.toBe(closed);
  });

  test('a second review card opens at its own picks, with no note and no team kept from the card before', async ({ page }) => {
    await runDesk(page, 0);
    await runUntilCards(page, 2);
    await openReview(page, cards(page).first());
    const team = field(page, 'Team');
    const was = await team.inputValue();
    const teams = await team.locator('option').evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    await team.selectOption(teams.find((value) => value !== was) ?? '');
    await noteBox(page).fill(NOTE);
    await sendButton(page).click();
    await expect(dialog(page)).toBeHidden();
    await aPersonsPause(page);

    await openReview(page, cards(page).first());
    await expect(noteBox(page)).toHaveValue('');
    await expect(sendButton(page)).toHaveText('Looks good, send it');
    // The team has not been chosen on this card, so it follows the category again.
    const current = await team.inputValue();
    const next = (Object.keys(ROUTES) as Category[]).find((name) => ROUTES[name] !== current);
    await field(page, 'Category').selectOption(next ?? '');
    await expect(team).toHaveValue(ROUTES[next as Category]);
  });

  test('acting on a card lower in the list moves focus to the card that took its place, not the first', async ({ page }) => {
    await runDesk(page, 0);
    await runUntilCards(page, 3);
    const ids = await cards(page).evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset['ticket'] ?? ''));
    await openReview(page, cards(page).nth(1));
    await sendButton(page).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator(`#open-list > li[data-ticket="${ids[1] ?? ''}"]`)).toHaveCount(0);
    await expect(page.locator('#open-list button:focus')).toHaveAccessibleName(`Review ${ids[2] ?? ''}`);
  });

  test('Approve works on a run that has been stopped', async ({ page }) => {
    await runDesk(page, 0);
    const card = await runUntilApprove(page);
    const id = (await card.getAttribute('data-ticket')) ?? '';
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    await approveOf(card).click();
    await expect(page.locator(`#sent-list > li[data-ticket="${id}"] .how`)).toHaveText('You approved');
    await expect(page.locator(`#open-list > li[data-ticket="${id}"]`)).toHaveCount(0);
  });
});

test.describe('the bar on a wide screen', () => {
  test.use({ viewport: WIDE });

  test('Model History stays reachable on the bar during a run', async ({ page }) => {
    await runDesk(page);
    const link = page.getByRole('link', { name: 'Model History' });
    await expect(link).toBeVisible();
    const box = await boxOf(link);
    expect(box.y + box.height).toBeLessThanOrEqual(WIDE.height);
    // During a run it opens beside the desk, so the run is not lost.
    const [opened] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await expect(opened).toHaveURL(/\/model-history\.html$/);
  });
});

test.describe('info tips', () => {
  test.describe('on a short screen', () => {
    test.use({ viewport: SHORT });

    test('an open tip follows its icon when the panel under it scrolls', async ({ page }) => {
      await runDesk(page);
      await more(page).click();
      const icon = tip(page, 'What high-risk missed means');
      await icon.focus();
      await expect(tooltip(page)).toHaveCount(1);
      const before = await boxOf(icon);
      const gap = (await boxOf(tooltip(page))).y - before.y;
      await side(page).evaluate((node) => {
        node.scrollTop += 60;
      });
      // The panel did move the icon, so a box left where it was is a box left behind.
      expect(before.y - (await boxOf(icon)).y).toBeGreaterThan(0);
      await expect.poll(async () => (await boxOf(tooltip(page))).y - (await boxOf(icon)).y).toBeCloseTo(gap, 0);
    });

    test('a tip whose icon is low on the screen opens above it, on the screen, and not over it', async ({ page }) => {
      await runDesk(page);
      await more(page).click();
      const icon = tip(page, 'Where the hourly pay figure comes from');
      await icon.evaluate((node) => node.scrollIntoView({ block: 'end' }));
      await icon.focus();
      await expect(tooltip(page)).toHaveCount(1);
      const at = await boxOf(icon);
      // Low enough that the box cannot fit below it, so a layout that moves the icon up fails here and not silently.
      expect(at.y).toBeGreaterThan(SHORT.height / 2);
      const box = await boxOf(tooltip(page));
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(at.y);
    });
  });

  test.describe('on a wide screen', () => {
    test.use({ viewport: WIDE });

    test('an open tip follows its icon when the window is resized', async ({ page }) => {
      await runDesk(page);
      await more(page).click();
      const icon = tip(page, 'What high-risk missed means');
      await icon.focus();
      await expect(tooltip(page)).toHaveCount(1);
      await page.setViewportSize(NARROWER);
      await expect
        .poll(async () => {
          const box = await boxOf(tooltip(page));
          const at = await boxOf(icon);
          return box.x + box.width <= NARROWER.width && box.x <= at.x && at.x <= box.x + box.width;
        })
        .toBe(true);
    });

    test('a key press on an icon closes its open tip and a second press opens it again', async ({ page }) => {
      await runDesk(page);
      await tip(page, 'What percent sure means').focus();
      await expect(tooltip(page)).toHaveCount(1);
      await page.keyboard.press('Enter');
      await expect(tooltip(page)).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(tooltip(page)).toHaveCount(1);
    });
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('Numbers pressed over a report on a held running run lets the run go on', async ({ page }) => {
    await runDesk(page);
    await numbersButton(page).tap();
    await more(page).tap();
    await generate(page).tap();
    await expect(report(page)).toBeVisible();
    await numbersButton(page).tap();
    await expect(report(page)).toBeHidden();
    await expect(side(page)).toBeVisible();
    await fadesDone(page);
    const closed = await textOf(page, '#n-closed');
    await page.clock.runFor(RUN_MS);
    await fadesDone(page);
    expect(await textOf(page, '#n-closed')).not.toBe(closed);
  });

  test('Back to the tickets returns to the tab that was showing', async ({ page }) => {
    await runDesk(page);
    await tab(page, 'Sent to teams').tap();
    await numbersButton(page).tap();
    await expect(side(page)).toBeVisible();
    await page.getByRole('button', { name: 'Back to the tickets' }).tap();
    await expect(side(page)).toBeHidden();
    await expect(page.locator('#sent-list')).toBeVisible();
    await expect(page.locator('#open-list')).toBeHidden();
    await expect(tab(page, 'Sent to teams')).toBeFocused();
  });

  test('High-risk missed and Right with no person on top follow the run', async ({ page }) => {
    test.setTimeout(120_000);
    await runDesk(page, RUN_MS, MISSED_SEED);
    const same = async (): Promise<void> => {
      await fadesDone(page);
      for (const [top, panel] of [
        ['#p-missed', '#n-missed'],
        ['#p-right', '#n-right'],
      ] as const) {
        expect(await textOf(page, top), top).toBe(await textOf(page, panel));
      }
    };
    expect(Number(await textOf(page, '#n-right'))).toBeGreaterThan(0);
    await same();
    await finishRun(page);
    expect(Number(await textOf(page, '#n-missed'))).toBeGreaterThan(0);
    await same();
  });

  test('only the chosen tab is a stop in the Tab order, and the arrow keys carry that stop with the choice', async ({ page }) => {
    await runDesk(page);
    const open = tab(page, 'Needs a person');
    const sent = tab(page, 'Sent to teams');
    await expect(open).toHaveJSProperty('tabIndex', 0);
    await expect(sent).toHaveJSProperty('tabIndex', -1);
    await open.focus();
    await page.keyboard.press('ArrowRight');
    await expect(sent).toBeFocused();
    await expect(sent).toHaveJSProperty('tabIndex', 0);
    await expect(open).toHaveJSProperty('tabIndex', -1);
    await page.keyboard.press('Shift+Tab');
    await expect(open).not.toBeFocused();
    await sent.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(open).toBeFocused();
    await expect(open).toHaveJSProperty('tabIndex', 0);
    await expect(sent).toHaveJSProperty('tabIndex', -1);
  });
});

// A site published under a project folder (https://name.github.io/project/) breaks a link that starts at the root.
test('every link between the pages resolves inside the folder the site is served from', async ({ page }) => {
  const BASE = 'https://site.test/project/index.html';
  const seen: string[] = [];
  for (const path of ['/', '/model-history.html', '/under-the-hood.html']) {
    await page.goto(path);
    const hrefs = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    for (const href of hrefs) {
      const url = new URL(href, BASE);
      if (url.origin !== new URL(BASE).origin) continue;
      seen.push(href);
      expect(url.pathname, `${path} links to ${href}`).toMatch(/^\/project\//);
    }
  }
  expect(seen).toEqual(expect.arrayContaining(['model-history.html', 'under-the-hood.html', 'index.html']));
});
