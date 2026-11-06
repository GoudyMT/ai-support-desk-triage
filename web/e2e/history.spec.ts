import { expect, test } from '@playwright/test';

const HISTORY_PATH = '/model-history.html';
const NARROW = { width: 375, height: 812 };

test('the page lists the newest model first with its numbers and an arrow a screen reader can read', async ({ page }) => {
  await page.goto(HISTORY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Model History' })).toBeVisible();
  const rows = page.locator('#rows > tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Baseline model (current)');
  await expect(rows.nth(0)).toContainText('Word weights plus safety rules');
  await expect(rows.nth(1)).toContainText('Course prototype');
  await expect(rows.nth(0).locator('td')).toContainText(['57.3%', '39 of 48', '0 of 24', '78%', '6.8']);
  await expect(rows.nth(1).locator('td')).toContainText(['33.6%', '14 of 48', 'Not measured', 'Not measured', 'Not measured']);
  const arrow = page.getByRole('img', { name: 'up 23.7 points' });
  await expect(arrow).toHaveText('23.7 pts');
  await expect(page.getByRole('img', { name: 'up 25 tickets' })).toHaveText('25');
  await expect(arrow).toHaveCSS('font-size', '13px');
  await expect(arrow).toHaveCSS('font-weight', '400');
  await expect(arrow).toHaveCSS('color', 'rgb(22, 101, 52)');
  await expect(page.getByText('Baseline 57.3%. No change yet')).toBeVisible();
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
  await expect(page.locator('#rows > tr')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const box = page.getByRole('region', { name: 'History, newest first' });
  expect(await box.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await box.focus();
  await expect(box).toBeFocused();
});
