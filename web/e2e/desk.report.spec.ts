import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { dollarsText, minutesText } from '../src/run/valueSaved';
import { SEED, START, tabTo } from './helpers';

const TICKETS_IN_A_RUN = 130;
const RUN_STEP_MS = 10_000;
const MAX_RUN_STEPS = 60;
const ENDED = 'All 130 tickets handled. Open More numbers and report, or press Start to run a new set.';
const KEPT = 'Kept 3. Enter a number of 0 or more.';
const VALUE_TAIL = ' saved this run. An estimate, not a measurement.';
const ROW_LABELS = [
  'Sent to a person',
  'Changed at review',
  'Handled with no person',
  'Software time per ticket',
  'Time saved (estimate)',
  'Value saved (estimate)',
  'Wrong quick approvals',
];

// Opens the desk with the clock under the test's control: nothing moves until `runFor`.
async function openDesk(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${SEED}`);
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
}

const more = (page: Page): Locator => page.getByRole('button', { name: /^(More numbers and report|Fewer numbers)$/ });
const generate = (page: Page): Locator => page.getByRole('button', { name: 'Generate report' });
const closeReport = (page: Page): Locator => page.getByRole('button', { name: 'Close report' });
const report = (page: Page): Locator => page.locator('#report');
const minutes = (page: Page): Locator => page.getByRole('textbox', { name: 'Minutes saved per ticket' });
const pay = (page: Page): Locator => page.getByRole('textbox', { name: 'Hourly pay ($)' });
const valueLine = (page: Page): Locator => page.locator('.value-line');
const reportRows = (page: Page): Locator => page.locator('#report-rows dd');

// A run going, with the panel opened out and some tickets closed.
async function runWithPanel(page: Page, ms = 60_000): Promise<void> {
  await openDesk(page);
  await start(page);
  await page.clock.runFor(ms);
  await more(page).click();
}

// A changed number fades out and then in on the browser's own clock, not the test's, so its text is final only once the
// animations are over.
async function fadesDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
    .toBe(0);
}

// Everything the desk shows about the run that must stand still while the report holds it.
async function held(page: Page): Promise<string[]> {
  await fadesDone(page);
  return [
    (await page.locator('#open-list').textContent()) ?? '',
    (await page.locator('#sent-list').textContent()) ?? '',
    (await page.locator('#n-closed').textContent()) ?? '',
  ];
}

async function finishRun(page: Page): Promise<void> {
  const toggle = page.locator('#toggle');
  for (let step = 0; step < MAX_RUN_STEPS && (await toggle.innerText()) !== 'Start'; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
  }
  await expect(toggle).toHaveText('Start');
  await expect(page.getByText(ENDED)).toBeVisible();
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test.describe('Generate report', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('is off until a ticket has closed, then on', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await more(page).click();
    await expect(generate(page)).toBeDisabled();
    await page.clock.runFor(30_000);
    await expect(generate(page)).toBeEnabled();
  });

  test('mid-run: the report holds the run, Close report lets it go on, and focus goes back to the button', async ({
    page,
  }) => {
    await runWithPanel(page, 30_000);
    const before = await held(page);
    await generate(page).click();
    await expect(page.getByRole('heading', { level: 2, name: /^After action report so far: \d+ of 130 tickets$/ })).toBeFocused();
    await expect(page.locator('#open-list')).toBeHidden();
    await expect(page.locator('#sent-list')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
    await expect(page.locator('aside.side')).toBeVisible();
    await page.clock.runFor(60_000);
    expect(await held(page)).toEqual(before);
    await closeReport(page).click();
    await expect(report(page)).toBeHidden();
    await expect(generate(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.clock.runFor(30_000);
    expect(await held(page)).not.toEqual(before);
  });

  test('a run that was stopped stays stopped after the report is closed', async ({ page }) => {
    await runWithPanel(page, 30_000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    const before = await held(page);
    await generate(page).click();
    await expect(report(page)).toBeVisible();
    await closeReport(page).click();
    await expect(report(page)).toBeHidden();
    await page.clock.runFor(60_000);
    expect(await held(page)).toEqual(before);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  });

  test('Start in the bar closes the report and the run goes on', async ({ page }) => {
    await runWithPanel(page, 30_000);
    const before = await held(page);
    await generate(page).click();
    await expect(report(page)).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(report(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.clock.runFor(30_000);
    expect(await held(page)).not.toEqual(before);
  });

  test('Try a ticket opened over a report leaves the report and its hold alone', async ({ page }) => {
    await runWithPanel(page, 30_000);
    await generate(page).click();
    await expect(report(page)).toBeVisible();
    const before = await held(page);
    await page.getByRole('button', { name: 'Try a ticket' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(report(page)).toBeVisible();
    await page.clock.runFor(60_000);
    expect(await held(page)).toEqual(before);
    await closeReport(page).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.clock.runFor(30_000);
    expect(await held(page)).not.toEqual(before);
  });

  test('a finished run does not open it; Generate report shows all 130 tickets, and a new run closes it', async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await openDesk(page);
    await start(page);
    await more(page).click();
    await minutes(page).fill('3');
    await finishRun(page);
    await fadesDone(page);
    await expect(report(page)).toBeHidden();
    await expect(generate(page)).toBeEnabled();
    await generate(page).click();
    await expect(page.getByRole('heading', { level: 2, name: 'After action report: 130 tickets' })).toBeVisible();
    await expect(page.locator('#report-rows dt')).toHaveText(ROW_LABELS);
    await expect(reportRows(page)).toHaveCount(ROW_LABELS.length);
    await expect(page.locator('#report-table thead th')).toHaveText([
      'Right answers',
      'Old keyword method',
      'Model alone',
      'After review',
    ]);
    // The panel and the report read the same closed tickets.
    await expect(reportRows(page).nth(0)).toHaveText((await page.locator('#n-sent').textContent()) ?? '');
    await expect(reportRows(page).nth(6)).toHaveText('0 of 0');
    await expect(page.locator('#report-lead')).toHaveText(/got past review\. The model alone got the category right \d+% of the time, and the simulated reviewer checked \d+ of 130 tickets\.$/);
    // The footer says what the numbers rest on, with the assumption edited above.
    await expect(page.locator('#report-footer')).toHaveText(
      'Made-up tickets. After review uses a simulated reviewer that is wrong 5% of the time. Estimates assume 3 minutes per ticket and $21.53 an hour. A live run uses different tickets from the test sets, so these numbers differ.',
    );
    await shot(page, info, 'report');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(report(page)).toBeHidden();
    await expect(page.locator('#n-closed')).toHaveText(`0 of ${TICKETS_IN_A_RUN}`);
    await expect(page.locator('#n-sent')).toHaveText('0 (0%)');
    await expect(minutes(page)).toHaveValue('3');
    await expect(generate(page)).toBeDisabled();
  });
});

test.describe('assumptions', () => {
  test('editing them changes the result line and the open report; a bad entry keeps the last good value and says so', async ({
    page,
  }) => {
    await runWithPanel(page, 120_000);
    await fadesDone(page);
    const counted = Number(await page.locator('#n-right').textContent());
    expect(counted).toBeGreaterThan(0);
    const line = (mins: number, hourly: number): string =>
      `${minutesText(counted * mins)}, ${dollarsText(((counted * mins) / 60) * hourly)}${VALUE_TAIL}`;
    await expect(minutes(page)).toHaveValue('2');
    await expect(pay(page)).toHaveValue('21.53');
    await expect(valueLine(page)).toHaveText(line(2, 21.53));
    await generate(page).click();
    await expect(reportRows(page).nth(4)).toHaveText(minutesText(counted * 2));
    await minutes(page).fill('3');
    await expect(valueLine(page)).toHaveText(line(3, 21.53));
    await expect(reportRows(page).nth(4)).toHaveText(minutesText(counted * 3));
    await expect(reportRows(page).nth(5)).toHaveText(dollarsText(((counted * 3) / 60) * 21.53));
    await pay(page).fill('40');
    await expect(reportRows(page).nth(5)).toHaveText(dollarsText(((counted * 3) / 60) * 40));
    await minutes(page).fill('abc');
    await expect(page.locator('#err-minutes')).toHaveText(KEPT);
    await expect(valueLine(page)).toHaveText(line(3, 40));
    await expect(reportRows(page).nth(4)).toHaveText(minutesText(counted * 3));
    await minutes(page).fill('0');
    await expect(page.locator('#err-minutes')).toBeEmpty();
    await expect(valueLine(page)).toHaveText(`0 min, $0.00${VALUE_TAIL}`);
  });
});

test('keyboard only: Start to a report and back, with focus where it should be', async ({ page }) => {
  await openDesk(page);
  await tabTo(page, 'Start');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.clock.runFor(60_000);
  await tabTo(page, /numbers$/, true);
  await expect(more(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(more(page)).toHaveAccessibleName('Fewer numbers');
  await tabTo(page, 'Generate report');
  await page.keyboard.press('Enter');
  await expect(page.locator('#report-title')).toBeFocused();
  await tabTo(page, 'Close report');
  await page.keyboard.press('Enter');
  await expect(report(page)).toBeHidden();
  await expect(generate(page)).toBeFocused();
});

test('printing shows the report alone, with no bar, panel or header', async ({ page }) => {
  await runWithPanel(page, 60_000);
  await generate(page).click();
  await expect(report(page)).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(report(page)).toBeVisible();
  await expect(page.locator('.bar')).toBeHidden();
  await expect(page.locator('aside.side')).toBeHidden();
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  // What the numbers rest on goes to paper with them.
  await expect(page.locator('#report-footer')).toBeVisible();
});

// Ctrl+P does not need the report: whatever the page shows then is what prints, and a viewer's notes are not for paper.
test('printing with no report open shows the run numbers and none of the tickets or notes', async ({ page }) => {
  await runWithPanel(page, 60_000);
  await page.locator('#open-list button[aria-label^="Review "]').first().click();
  await page.clock.runFor(450);
  await page.getByRole('dialog').getByLabel('Note for the team (optional)').fill('private note');
  await page.getByRole('dialog').getByRole('button', { name: /^(Looks good, send it|Send with my changes)$/ }).click();
  await expect(page.locator('.your-note')).toHaveText('Your note: private note');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#open-list')).toBeHidden();
  await expect(page.locator('#sent-list')).toBeHidden();
  await expect(page.locator('.your-note')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'This run' })).toBeVisible();
  await expect(page.locator('#n-closed')).toBeVisible();
  await expect(page.locator('.bar')).toBeHidden();
  await expect(more(page)).toBeHidden();
  await expect(generate(page)).toBeHidden();
});

test('Print or save as PDF asks the browser to print', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { printed: 0, print: () => ((window as unknown as { printed: number }).printed += 1) });
  });
  await runWithPanel(page, 30_000);
  await generate(page).click();
  await page.getByRole('button', { name: 'Print or save as PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
});

// A screen too short for the whole panel is the case where it must scroll inside itself.
for (const height of [800, 520]) {
  test.describe(`at 1280 wide and ${height} high`, () => {
    test.use({ viewport: { width: 1280, height } });

    test('the opened-out panel scrolls inside the page and its last control is not behind the bar', async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await runWithPanel(page, 120_000);
      await expect(generate(page)).toBeVisible();
      const side = page.locator('aside.side');
      const reached = await side.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return { top: node.scrollTop, room: node.scrollHeight - node.clientHeight };
      });
      expect(reached.top).toBe(reached.room);
      if (height < 600) expect(reached.room).toBeGreaterThan(0);
      const bar = (await page.locator('.bar').boundingBox())?.y ?? 0;
      const last = await generate(page).boundingBox();
      expect(last).not.toBeNull();
      expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(bar);
      const sideBox = await side.boundingBox();
      expect((sideBox?.y ?? 0) + (sideBox?.height ?? 0)).toBeLessThanOrEqual(bar);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
      await shot(page, info, 'panel-expanded');
      await side.evaluate((node) => {
        node.scrollTop = 0;
      });
      await expect(page.getByRole('heading', { name: 'This run' })).toBeInViewport();
      await generate(page).click();
      await expect(report(page)).toBeVisible();
      await shot(page, info, 'report-open');
    });
  });
}
