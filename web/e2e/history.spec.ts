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
  // Each change is looked for inside its own cell, so an arrow drawn beside the wrong number fails here.
  for (const [at, row] of VIEW.rows.entries()) {
    const line = rows.nth(at);
    await expect(line.locator('th')).toContainText(row.name);
    await expect(line.locator('th')).toContainText(row.kind);
    await expect(line.getByRole('img')).toHaveCount(row.cells.filter((cell) => cell.change !== null).length);
    for (const [column, cell] of row.cells.entries()) {
      const td = line.locator('td').nth(column);
      await expect(td.locator('.value')).toHaveText(cell.value);
      if (cell.change !== null) {
        await expect(td.getByRole('img', { name: cell.change.label, exact: true })).toHaveText(cell.change.text);
      }
    }
  }
  // Every change shares one style, so the first one drawn stands for all; the view must hold at least one.
  const firstChange = VIEW.rows.findIndex((row) => row.cells.some((cell) => cell.change !== null));
  expect(firstChange).toBeGreaterThanOrEqual(0);
  const arrow = rows.nth(firstChange).getByRole('img').first();
  await expect(arrow).toHaveCSS('font-size', '13px');
  await expect(arrow).toHaveCSS('font-weight', '400');
  await expect(arrow).toHaveCSS('color', 'rgb(22, 101, 52)');
  // Each block is found by the start of its title: the tip moved in after a title can name another block's words.
  await expect(page.locator('.block')).toHaveCount(VIEW.blocks.length);
  for (const block of VIEW.blocks) {
    const startsWithTitle = new RegExp(`^${block.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const box = page.locator('.block').filter({ has: page.locator('.block-title', { hasText: startsWithTitle }) });
    await expect(box).toHaveCount(1);
    await expect(box.locator('.block-value')).toHaveText(block.value);
    await expect(box.locator('.block-note')).toContainText(block.baseline);
    await expect(box.getByRole('img')).toHaveCount(block.change === null ? 0 : 1);
    if (block.change !== null) {
      await expect(box.getByRole('img', { name: block.change.label, exact: true })).toHaveText(block.change.text);
    }
  }
  // The column says what the tickets are: written for this project, not hand-written.
  await expect(page.locator('#head th').nth(2)).toHaveText('Right on tickets written for this project');
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
