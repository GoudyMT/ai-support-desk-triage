import { expect, test, type Page } from '@playwright/test';
import { FAST_STATUS, SLOW_STATUS, open } from './helpers';

// See The Process: slow first, Speed up and Slow down in the bar, and the offer at the end of the slow part.
const OFFER_STATUS = 'That was the slow part. Press Speed up to see a busy day.';
// Three tickets of 20 s each, the first of which is already in the center; the third leaves at 60 s.
const SLOW_PART_MS = 60_000;
// A quick ticket takes 250 ms in each of the four stages.
const QUICK_TICKET_MS = 1_000;
const BUSY_WATCH_MS = 90_000;

const status = (page: Page) => page.locator('#status');
const speed = (page: Page, name: 'Speed up' | 'Slow down') => page.getByRole('button', { name, exact: true });
const stage = (page: Page) => page.locator('#ticket .now-stage');

test.describe('See The Process starts slow', () => {
  test('says so in the bar and offers Speed up, as a line button until the offer', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(status(page)).toHaveText(SLOW_STATUS);
    await expect(speed(page, 'Speed up')).toBeVisible();
    await expect(speed(page, 'Speed up')).not.toHaveClass(/btn-solid/);
    // A slow ticket stays at Intake for five seconds.
    await page.clock.runFor(QUICK_TICKET_MS);
    await expect(stage(page)).toHaveText('Now: Intake');
  });

  test('Speed up makes the ticket in the center and the rest quick, and the button becomes Slow down', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await speed(page, 'Speed up').click();
    await expect(status(page)).toHaveText(FAST_STATUS);
    await expect(speed(page, 'Slow down')).toBeVisible();
    await page.clock.runFor(QUICK_TICKET_MS);
    await expect(stage(page)).not.toHaveText('Now: Intake');
  });

  test('Slow down brings the slow pace back for the next tickets', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await speed(page, 'Speed up').click();
    await page.clock.runFor(QUICK_TICKET_MS * 3);
    await speed(page, 'Slow down').click();
    await expect(status(page)).toHaveText(SLOW_STATUS);
    await expect(speed(page, 'Speed up')).toBeVisible();
    // The next ticket to enter the center stays at Intake for five seconds.
    const ticket = page.locator('#ticket .now-title');
    const before = await ticket.getAttribute('data-ticket');
    for (let n = 0; n < 40 && (await ticket.getAttribute('data-ticket')) === before; n += 1) await page.clock.runFor(250);
    await page.clock.runFor(QUICK_TICKET_MS);
    await expect(stage(page)).toHaveText('Now: Intake');
  });
});

test.describe('the end of the slow part', () => {
  test('pauses the run, says what happened and makes Speed up the main button', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.clock.runFor(SLOW_PART_MS - 1_000);
    await expect(status(page)).toHaveText(SLOW_STATUS);
    await page.clock.runFor(2_000);
    await expect(status(page)).toHaveText(OFFER_STATUS);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(speed(page, 'Speed up')).toHaveClass(/btn-solid/);
    // Paused means paused: nothing moves while the offer stands.
    const waiting = await page.locator('#incoming .cards li').count();
    await page.clock.runFor(30_000);
    expect(await page.locator('#incoming .cards li').count()).toBe(waiting);
    await expect(status(page)).toHaveText(OFFER_STATUS);
  });

  test('Speed up then plays the busy day at once', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.clock.runFor(SLOW_PART_MS + 1_000);
    await speed(page, 'Speed up').click();
    await expect(status(page)).toHaveText(FAST_STATUS);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.clock.runFor(QUICK_TICKET_MS * 2);
    await expect(speed(page, 'Slow down')).toBeVisible();
  });

  test('Play after the offer goes on at the quick pace', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.clock.runFor(SLOW_PART_MS + 1_000);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(status(page)).toHaveText(FAST_STATUS);
    const ticket = page.locator('#ticket .now-title');
    const before = await ticket.getAttribute('data-ticket');
    await page.clock.runFor(QUICK_TICKET_MS * 2);
    expect(await ticket.getAttribute('data-ticket')).not.toBe(before);
  });

  test('is not made to a viewer who already sped up', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await speed(page, 'Speed up').click();
    await page.clock.runFor(BUSY_WATCH_MS);
    await expect(status(page)).not.toHaveText(OFFER_STATUS);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });
});
