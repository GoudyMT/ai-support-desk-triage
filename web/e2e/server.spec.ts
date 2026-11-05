import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { FIRST_OPEN_MS, SEED, SLOW_TEST_MS, START, seeAndPause } from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

const SERVER_SETTLE_MS = 1_500;

// A server of the built page that writes down every path it is asked for. The browser's own request
// events leave out what the browser asks for by itself (the page used to cause a request for
// /favicon.ico, on its own origin, which no origin filter catches); the server hears all of it.
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

async function serveBuild(): Promise<{ origin: string; asked: string[]; stop: () => Promise<void> }> {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const asked: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    asked.push(path);
    const file = join(root, path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    asked,
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
}

test.describe('what the server is asked for', () => {
  const OWN_FILES = [/^\/$/, /^\/assets\/[\w.-]+\.(js|css)$/, /^\/models\/fold_1\.json$/, /^\/favicon\.svg$/];

  test('is the page, its own scripts and styles, its one model and its icon, and nothing else', async ({ page }) => {
    const build = await serveBuild();
    try {
      await page.clock.install({ time: START });
      await page.clock.pauseAt(new Date(START.getTime() + 1000));
      await page.goto(`${build.origin}/?seed=${SEED}`);
      await seeAndPause(page);
      await page.getByRole('button', { name: 'Play' }).click();
      await page.clock.runFor(FIRST_OPEN_MS);
      // Let the browser's own requests (the icon comes after the page has loaded) reach the server.
      await page.waitForTimeout(SERVER_SETTLE_MS);
      expect(build.asked.filter((path) => !OWN_FILES.some((own) => own.test(path)))).toEqual([]);
      expect(build.asked).toContain('/models/fold_1.json');
    } finally {
      await build.stop();
    }
  });

  test('has an icon of its own, linked by a relative path, that the server hands out', async ({ page, request }) => {
    const build = await serveBuild();
    try {
      await page.goto(`${build.origin}/?seed=${SEED}`);
      const href = await page.locator('link[rel="icon"]').getAttribute('href');
      expect(href).toBe('favicon.svg');
      const icon = await request.get(`${build.origin}/${href}`);
      expect(icon.status()).toBe(200);
      expect(icon.headers()['content-type']).toBe('image/svg+xml');
    } finally {
      await build.stop();
    }
  });
});
