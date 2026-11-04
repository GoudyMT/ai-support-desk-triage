import { expect, type Page } from '@playwright/test';

// Seed 1001 runs on fold 1. At learn pace its first ticket (T-1001-0) leaves the center for the
// open list 20 s into the run; the model's picks for it are Billing, Medium and the Billing Team.
export const SEED = 1001;
export const START = new Date('2026-01-01T09:00:00');
export const FIRST_OPEN_MS = 20_500;
export const OPEN_POLL_MS = 250;
const MAX_OPEN_POLLS = 4000;

// Opens the page with the clock under the test's control: nothing moves until `runFor`. The
// clock is stopped before the page loads: an installed clock ticks in real time, so pausing it
// after a slow load (the model is 3 MB) could land in the past and fail.
export async function open(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/${query}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
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
    await page.clock.runFor(OPEN_POLL_MS);
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
export async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  for (let n = 0; n < MAX_TABS; n += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (typeof name === 'string' ? label === name : name.test(label)) return;
  }
  throw new Error(`test: Tab never reached ${String(name)}`);
}

// Plays the run until the open list holds at least `count` tickets.
export async function playUntilOpenCount(page: Page, count: number): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  const cards = page.locator('#outgoing .open > li');
  for (let n = 0; n < MAX_OPEN_POLLS && (await cards.count()) < count; n += 1) {
    await page.clock.runFor(OPEN_POLL_MS);
  }
  expect(await cards.count()).toBeGreaterThanOrEqual(count);
}
