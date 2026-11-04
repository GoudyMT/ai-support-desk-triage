import { expect, type Page } from '@playwright/test';

// Seed 1001 runs on fold 1. At learn pace its first ticket (T-1001-0) leaves the center for the
// open list 20 s into the run; the model's picks for it are Billing, Medium and the Billing Team.
export const SEED = 1001;
export const START = new Date('2026-01-01T09:00:00');
export const FIRST_OPEN_MS = 20_500;
export const OPEN_POLL_MS = 250;
const MAX_OPEN_POLLS = 4000;

// Opens the page with the clock under the test's control: nothing moves until `runFor`.
export async function open(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await page.clock.install({ time: START });
  await page.goto(`/${query}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
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

// Plays the run until the open list holds at least `count` tickets.
export async function playUntilOpenCount(page: Page, count: number): Promise<void> {
  await page.getByRole('button', { name: 'Play' }).click();
  const cards = page.locator('#outgoing .open > li');
  for (let n = 0; n < MAX_OPEN_POLLS && (await cards.count()) < count; n += 1) {
    await page.clock.runFor(OPEN_POLL_MS);
  }
  expect(await cards.count()).toBeGreaterThanOrEqual(count);
}
