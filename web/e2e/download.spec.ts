import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';

// Every file the build serves with the model; the license and notice are text whose size the page does not state.
const SERVED_FILES = readdirSync(new URL('../public/models/bundle_v2/', import.meta.url)).sort();
const NOTICES = new Set(['LICENSE', 'NOTICE.md']);

// The page someone uses to take the model away: every file must be there, served by this site, and the size it states
// must be the size they get. Opening the page downloads nothing.

const PAGE = '/get-the-model.html';
const NARROW = { width: 375, height: 812 };
const KB = 1000;
const MB = 1000 * KB;

// The page writes sizes in decimal units, megabytes to one place and kilobytes whole.
function written(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} bytes`;
}

test('every file link answers from this site, and each stated size is the file it serves', async ({ page, baseURL }) => {
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { level: 1, name: 'Get the model' })).toBeVisible();
  const items = page.locator('.files li');
  // The list is every file the site serves with the model, and each model file states its size.
  const names = await items.getByRole('link').allTextContents();
  expect([...names].sort()).toEqual(SERVED_FILES);
  for (const [at, name] of names.entries()) {
    const item = items.nth(at);
    const href = await item.getByRole('link').getAttribute('href');
    const url = new URL(href ?? '', `${baseURL}/`);
    expect(url.origin).toBe(new URL(baseURL ?? '').origin);
    const response = await page.request.get(url.href);
    expect(response.status(), url.pathname).toBe(200);
    if (!NOTICES.has(name)) {
      await expect(item.locator('.size')).toHaveText(written((await response.body()).length));
    }
  }
});

// The page links to GitHub and Hugging Face; a click must not tell them which page the visitor came from.
test('links to other sites send no referrer', async ({ page }) => {
  await page.goto(PAGE);
  expect(await page.evaluate(() => document.querySelector('meta[name="referrer"]')?.getAttribute('content'))).toBe('no-referrer');
});

test('opening the page downloads no model file', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(PAGE);
  await page.waitForLoadState('networkidle');
  expect(asked.filter((path) => path.includes('/models/'))).toEqual([]);
});

test('Model History links to the page, and the page leads back', async ({ page }) => {
  await page.goto('/model-history.html');
  await page.getByRole('link', { name: 'Get the model' }).click();
  await expect(page).toHaveURL(/\/get-the-model\.html$/);
  await page.locator('.bar').getByRole('link', { name: 'Model History' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Model History' })).toBeVisible();
});

// The code sample is wider than a phone; it scrolls inside its own box.
test('at a phone width the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto(PAGE);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByRole('region', { name: 'Python example' })).toBeVisible();
});
