import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { MAX_TICKET_CHARS } from '../src/pipeline/intake';
import { SEED, START } from './helpers';

const LABEL = 'Type any support message. It stays in this page and is never sent or kept.';
const EMPTY = 'Type a support message first, then press Sort this ticket.';
const TOO_LONG = 'That message is over the 20,000 character limit. Shorten it, then press Sort this ticket.';
const LOAD_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
const WARNING = 'These are suggestions. A person must check them before anything reaches a customer.';
const PRIVACY =
  'Before the model reads a ticket, we hide email addresses, phone numbers, order numbers and card-like numbers. ' +
  'Names and street addresses are not hidden. Nothing you type is saved or sent.';
const EMAIL = 'jordan@mail.example.net';
const CARD = '4111-1111-1111-1111';
const PERSONAL = `Please write to ${EMAIL} about the charge on card ${CARD}.`;
const SAFETY = 'Someone accessed my account without permission.';
const SHIPPED = '/models/shipped.json';

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

const box = (page: Page): Locator => page.getByRole('textbox', { name: LABEL });
const sortButton = (page: Page): Locator => page.getByRole('button', { name: 'Sort this ticket' });
const result = (page: Page): Locator => page.locator('.try-result');
const dialog = (page: Page): Locator => page.getByRole('dialog');
const tryButton = (page: Page): Locator => page.getByRole('button', { name: 'Try a ticket' });

async function sort(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await sortButton(page).click();
}

// Requests made from now on, as paths.
function watchRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  return paths;
}

async function expectBarClear(page: Page): Promise<void> {
  const boxes = await page
    .locator('#toggle, #status-wrap, #bar-links :is(a, button):not([hidden])')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  for (const [at, a] of boxes.entries()) {
    for (const b of boxes.slice(at + 1)) {
      const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart, `${JSON.stringify(a)} against ${JSON.stringify(b)}`).toBe(true);
    }
  }
}

// A changed number fades out and then in on the browser's own clock, not the test's, so its text is final only once the
// animations are over.
async function fadesDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
    .toBe(0);
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test.describe('Try a ticket at rest', () => {
  test('a ticket with an address and a card number is sorted, and neither is left anywhere in the page', async ({ page }) => {
    await openDesk(page);
    await expect(page.getByRole('heading', { name: 'Try a ticket yourself' })).toBeVisible();
    await expect(page.getByText(PRIVACY, { exact: true })).toBeVisible();
    await expect(result(page)).toBeHidden();
    await sort(page, PERSONAL);
    await expect(result(page).locator('dt')).toHaveText(['Category', 'Priority', 'Team', 'Person needed']);
    await expect(result(page).locator('dd')).toHaveCount(4);
    await expect(page.getByText(WARNING, { exact: true })).toBeVisible();
    await expect(box(page)).toHaveValue(/\[EMAIL_ADDRESS\]/);
    await expect(box(page)).toHaveValue(/\[CARD_NUMBER\]/);
    const left = await page.evaluate(() => {
      const whole = document.documentElement.outerHTML;
      const values = [...document.querySelectorAll('textarea')].map((area) => area.value).join('\n');
      return { where: `${whole}\n${values}\n${location.href}`, stored: [localStorage.length, sessionStorage.length] };
    });
    expect(left.where).not.toContain(EMAIL);
    expect(left.where).not.toContain('jordan');
    expect(left.where).not.toContain('4111');
    expect(left.stored).toEqual([0, 0]);
  });

  test('the model file is asked for once across two sorts, and nothing else is asked for after the page loads', async ({
    page,
  }) => {
    await openDesk(page);
    await page.waitForLoadState('networkidle');
    const asked = watchRequests(page);
    await sort(page, SAFETY);
    await expect(result(page)).toBeVisible();
    await sort(page, 'Where is my package? The tracking number shows no update for a week.');
    await expect(result(page).locator('dd').nth(0)).toHaveText('Shipping/Order Issue');
    expect(asked).toEqual([SHIPPED]);
  });

  test('the answer for a safety ticket reads in the desk words, with the reason', async ({ page }) => {
    await openDesk(page);
    await sort(page, SAFETY);
    await expect(result(page).locator('dd')).toHaveText([
      'Security Concern',
      'Critical',
      'Security Team',
      'Yes: A rule caught "someone accessed", and Security Concern tickets always go to a person.',
    ]);
  });

  test('an empty box, spaces only and a message over the limit each say what is wrong and load no model', async ({
    page,
  }) => {
    await openDesk(page);
    await page.waitForLoadState('networkidle');
    const asked = watchRequests(page);
    const message = page.locator('#try-error');
    await expect(box(page)).toHaveAttribute('aria-describedby', /try-error/);
    await expect(message).toHaveAttribute('role', 'alert');
    await sort(page, '');
    await expect(message).toHaveText(EMPTY);
    await sort(page, '   \n  ');
    await expect(message).toHaveText(EMPTY);
    await sort(page, 'a'.repeat(MAX_TICKET_CHARS + 1));
    await expect(message).toHaveText(TOO_LONG);
    expect(asked).toEqual([]);
  });

  test('a refused ticket takes the old answer away, and a ticket of exactly the limit is sorted', async ({ page }) => {
    await openDesk(page);
    await sort(page, SAFETY);
    await expect(result(page)).toBeVisible();
    await sort(page, '');
    await expect(result(page)).toBeHidden();
    await expect(page.getByText(WARNING, { exact: true })).toBeHidden();
    await sort(page, 'a'.repeat(MAX_TICKET_CHARS));
    await expect(result(page)).toBeVisible();
    await expect(page.locator('#try-error')).toBeEmpty();
  });

  test('a model that fails to load shows the message and Retry, Retry then works, and Start still runs', async ({
    page,
  }) => {
    await page.route('**/models/shipped.json', (route) => route.abort());
    await openDesk(page);
    await sort(page, SAFETY);
    await expect(page.locator('#try-error')).toHaveText(LOAD_FAILED);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(result(page)).toBeHidden();
    await page.unroute('**/models/shipped.json');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(result(page)).toBeVisible();
    await expect(page.locator('#try-error')).toBeEmpty();
    await expect(sortButton(page)).toBeEnabled();
    await start(page);
    await page.clock.runFor(30_000);
    expect(await page.locator('#sent-list > li').count()).toBeGreaterThan(0);
  });
});

test.describe('Try a ticket during a run', () => {
  test('the bar button opens the form over the desk and the run holds; Escape closes it, focus returns and the run goes on', async ({
    page,
  }) => {
    await openDesk(page);
    await expect(tryButton(page)).toBeHidden();
    await start(page);
    await page.clock.runFor(30_000);
    await tryButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: 'Try a ticket yourself' })).toBeVisible();
    await sort(page, PERSONAL);
    await expect(result(page)).toBeVisible();
    await fadesDone(page);
    const held = await page.locator('#run').innerText();
    await page.clock.runFor(60_000);
    expect(await page.locator('#run').innerText()).toBe(held);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(tryButton(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.clock.runFor(30_000);
    expect(await page.locator('#run').innerText()).not.toBe(held);
  });

  test('a run that was stopped stays stopped when the form is closed with Close', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await page.clock.runFor(30_000);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    await fadesDone(page);
    const held = await page.locator('#run').innerText();
    await tryButton(page).click();
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(tryButton(page)).toBeFocused();
    // The panel goes back to the page in the same step that lets the run go on, so it is there once the close is done.
    await expect(page.locator('#rest > .try')).toHaveCount(1);
    await page.clock.runFor(60_000);
    await fadesDone(page);
    expect(await page.locator('#run').innerText()).toBe(held);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  });
});

test.describe('at 1280 wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the bar buttons do not overlap at rest or with the form open during a run', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDesk(page);
    await sort(page, SAFETY);
    await expect(result(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
      true,
    );
    await expectBarClear(page);
    await shot(page, info, 'rest-result');
    await start(page);
    await page.clock.runFor(90_000);
    await tryButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await expectBarClear(page);
    await shot(page, info, 'run-form');
  });
});
