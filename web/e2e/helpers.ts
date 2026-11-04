import { expect, type Page } from '@playwright/test';

// Seed 1001 runs on fold 1. At learn pace its first ticket (T-1001-0) leaves the center for the
// open list 20 s into the run; the model's picks for it are Billing, Medium and the Billing Team.
export const SEED = 1001;
export const START = new Date('2026-01-01T09:00:00');
export const FIRST_OPEN_MS = 20_500;
// T-1001-0 is at Privacy from 5 s, so from then Why this choice has something to show.
export const WHY_READY_MS = 6_000;
export const OPEN_POLL_MS = 250;
// What the bar says in See The Process for each pace.
export const SLOW_STATUS = 'Slowed down so you can follow along.';
export const FAST_STATUS = 'Busy day: full speed.';
// A test that polls the page hundreds of times takes about 15 s alone and over 30 s when three browsers
// share one machine, so each spec file that has such tests allows this long; a real hang still fails.
export const SLOW_TEST_MS = 90_000;
const MAX_OPEN_POLLS = 4000;

// Opens the page with the clock under the test's control: nothing moves until `runFor`. The
// clock is stopped before the page loads: an installed clock ticks in real time, so pausing it
// after a slow load (the model is 3 MB) could land in the past and fail.
// Learn The Process opens first, with its clock stopped too.
export async function openLearn(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/${query}`);
  await expect(page.locator('#learn-controls')).toBeVisible();
}

// From Learn to See The Process, then Pause: for a page the test loaded itself.
export async function seeAndPause(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'See The Process' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  // The clicks left focus on the bar, which is the end of the page. The rows that use the keyboard start
  // from the top of the page, as a visitor arriving does, so focus goes back to the start.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

// The page in See The Process, paused: the state the rows of the live board start from.
export async function open(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await openLearn(page, query);
  await seeAndPause(page);
}

// The run pauses itself at the end of the slow part and waits for Play or Speed up. A test that just lets
// time pass presses Play, as a viewer who wants the run to go on would. The press is dispatched, not
// clicked: a real click would move focus (or, in Safari, drop it), and tests of focus are watching it.
export async function playOnIfOffered(page: Page): Promise<void> {
  const play = page.getByRole('button', { name: 'Play', exact: true });
  if (await play.isVisible()) await play.dispatchEvent('click');
}

// Lets `ms` of the page's clock pass, going on past the offer.
export async function runPlaying(page: Page, ms: number): Promise<void> {
  await playOnIfOffered(page);
  await page.clock.runFor(ms);
}

const BUSY_DAY_LIMIT = 600;

// Plays on until the busy day (the second act) is under way: the center says its explanations are off.
export async function playToBusyDay(page: Page, stepMs = 1000): Promise<void> {
  const off = page.getByText('Explanations are off on the busy day.');
  for (let n = 0; n < BUSY_DAY_LIMIT && !(await off.isVisible()); n += 1) await runPlaying(page, stepMs);
  await expect(off).toBeVisible();
}

export function reviewButton(page: Page, id: string) {
  // By label, not by role: on a phone the list is display:none until its tab is chosen.
  return page.locator(`#outgoing button[aria-label="Review ${id}"]`);
}

// Runs the clock in small steps until the ticket is in the open list, before the simulated
// reviewer has had time to close it. Tickets reach the center in the order the pre-screener's
// tags set, so a later ticket's turn is found by looking, not by a fixed time.
export async function runUntilOpen(page: Page, id: string): Promise<void> {
  for (let n = 0; n < MAX_OPEN_POLLS && (await reviewButton(page, id).count()) === 0; n += 1) {
    await runPlaying(page, OPEN_POLL_MS);
  }
  await expect(reviewButton(page, id)).toBeVisible();
}

export async function playToFirstOpen(page: Page): Promise<void> {
  await open(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.clock.runFor(FIRST_OPEN_MS);
  await expect(reviewButton(page, 'T-1001-0')).toHaveCount(1);
}

export function stat(page: Page, label: string) {
  return page.locator('#stats > div', { hasText: label }).locator('dd');
}

export function moreNumber(page: Page, label: string) {
  return page.locator('#numbers > dl > div', { hasText: label }).locator('dd');
}

const MAX_TABS = 30;

// Presses Tab until the focused control's text matches; keyboard only, so no pointer and no focus().
// `back` goes the other way, with Shift+Tab: the bar is the last stop in the page, so a control in the
// board is behind it, and Firefox does not wrap from the end of the page to its start.
export async function tabTo(page: Page, name: string | RegExp, back = false): Promise<void> {
  for (let n = 0; n < MAX_TABS; n += 1) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (typeof name === 'string' ? label === name : name.test(label)) return;
  }
  throw new Error(`test: ${back ? 'Shift+Tab' : 'Tab'} never reached ${String(name)}`);
}

// Plays the run until the open list holds at least `count` tickets.
export async function playUntilOpenCount(page: Page, count: number): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  const cards = page.locator('#outgoing .open > li');
  for (let n = 0; n < MAX_OPEN_POLLS && (await cards.count()) < count; n += 1) {
    await runPlaying(page, OPEN_POLL_MS);
  }
  expect(await cards.count()).toBeGreaterThanOrEqual(count);
}
