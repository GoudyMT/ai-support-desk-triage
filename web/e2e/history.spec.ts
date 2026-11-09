import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { historyView, type HistoryRow } from '../src/history/view';

const HISTORY_PATH = '/model-history.html';
const NARROW = { width: 375, height: 812 };
// The expected words come from history.json through the same view the page draws, so a new model row moves
// them with no edit here. What this guards is the drawing: every row, newest first, every number, and arrows
// a screen reader can read. That the numbers are the ones the models earned is the CI history check's job.
const ROWS = JSON.parse(readFileSync(new URL('../src/history/history.json', import.meta.url), 'utf8')) as HistoryRow[];
const VIEW = historyView(ROWS);

test('the page lists the newest model first with its numbers and an arrow a screen reader can read', async ({ page }) => {
  await page.goto(HISTORY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Model History' })).toBeVisible();
  const rows = page.locator('#rows > tr');
  await expect(rows).toHaveCount(VIEW.rows.length);
  for (const [at, row] of VIEW.rows.entries()) {
    await expect(rows.nth(at)).toContainText(row.name);
    await expect(rows.nth(at)).toContainText(row.kind);
    await expect(rows.nth(at).locator('td')).toContainText(row.cells.map((cell) => cell.value));
  }
  const changes = VIEW.rows.flatMap((row) => row.cells.flatMap((cell) => (cell.change === null ? [] : [cell.change])));
  expect(changes.length).toBeGreaterThan(0);
  for (const change of changes) {
    await expect(page.getByRole('img', { name: change.label }).first()).toHaveText(change.text);
  }
  const up = changes.find((change) => change.direction === 'up');
  if (up !== undefined) {
    const arrow = page.getByRole('img', { name: up.label }).first();
    await expect(arrow).toHaveCSS('font-size', '13px');
    await expect(arrow).toHaveCSS('font-weight', '400');
    await expect(arrow).toHaveCSS('color', 'rgb(22, 101, 52)');
  }
  for (const block of VIEW.blocks) {
    await expect(page.getByText(block.baseline)).toBeVisible();
  }
  // The column and its block say what the tickets are: written for this project, not hand-written.
  await expect(page.locator('#head th').nth(2)).toHaveText('Right on tickets written for this project');
  await expect(page.locator('.block', { hasText: 'Right on tickets written for this project' })).toContainText(VIEW.blocks[1]?.value ?? '');
});

test('the bottom bar reaches the desk, Learn The Process and Under the Hood', async ({ page }) => {
  await page.goto(HISTORY_PATH);
  await page.getByRole('link', { name: 'Back to the desk' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('You are the support team');
  for (const name of ['Learn The Process', 'Under the Hood']) {
    await page.goto(HISTORY_PATH);
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/under-the-hood\.html$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Under the Hood' })).toBeVisible();
  }
});

test('the page asks for no model file', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(HISTORY_PATH);
  await page.waitForLoadState('networkidle');
  expect(asked.filter((path) => path.includes('/models/'))).toEqual([]);
});

// The table is wider than a phone; it scrolls inside its own box, so the page itself does not scroll sideways.
test('at a phone width the page does not scroll sideways, and the table scrolls inside its own box', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(HISTORY_PATH);
  await expect(page.locator('#rows > tr')).toHaveCount(VIEW.rows.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const box = page.getByRole('region', { name: 'History, newest first' });
  expect(await box.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await box.focus();
  await expect(box).toBeFocused();
});
