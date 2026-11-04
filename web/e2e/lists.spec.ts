import { expect, test, type Page } from '@playwright/test';
import { FIRST_OPEN_MS, SEED, moreNumber, open, playToFirstOpen, reviewButton, runUntilOpen } from './helpers';

// What each list and the center show for a ticket, and what a viewer's review does to them.
const POLL_MS = 250;
const POLLS = 400;
const STEP_LIMIT = 40;
const FIRST_TAG_MS = 5000;
const TAG_WORDS = ['Critical', 'High', 'Medium', 'Low'];

const closedIds = (page: Page) =>
  page.locator('#outgoing .closed li').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ticket') ?? ''));
const incomingIds = (page: Page) =>
  page.locator('#incoming .cards li').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ticket') ?? ''));
const centerId = (page: Page) =>
  page.locator('#ticket .now-title').evaluate((node) => node.getAttribute('data-ticket') ?? '');

async function stepTo(page: Page, stage: string): Promise<void> {
  const now = page.locator('#ticket .now-stage');
  for (let n = 0; n < STEP_LIMIT && (await now.innerText().catch(() => '')) !== `Now: ${stage}`; n += 1) {
    await page.getByRole('button', { name: 'Step' }).click();
  }
  await expect(now).toHaveText(`Now: ${stage}`);
}

test.describe('the lists', () => {
  test('Going out lists closed tickets newest first', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const closedOrder: string[] = [];
    for (let n = 0; n < POLLS; n += 1) {
      await page.clock.runFor(POLL_MS);
      for (const id of (await closedIds(page)).reverse()) if (!closedOrder.includes(id)) closedOrder.push(id);
    }
    expect(closedOrder.length).toBeGreaterThan(5);
    expect(await closedIds(page)).toEqual(closedOrder.reverse());
  });

  test('the ticket at the top of Coming in is the next one into the center', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    let top = '';
    let current = '';
    let checked = 0;
    for (let n = 0; n < POLLS; n += 1) {
      await page.clock.runFor(POLL_MS);
      const now = await centerId(page);
      if (now !== current && current !== '' && top !== '') {
        expect(now).toBe(top);
        checked += 1;
      }
      current = now;
      top = (await incomingIds(page))[0] ?? '';
    }
    expect(checked).toBeGreaterThan(3);
  });

  test('a waiting card shows its id, its first words and its tag', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(10_000);
    const card = page.locator('#incoming .cards li').first();
    await expect(card.locator('.card-title')).toHaveText(/^T-1001-\d+$/);
    const words = await card.locator('.card-line').innerText();
    expect(words.length).toBeGreaterThan(10);
    expect(words.length).toBeLessThanOrEqual(60);
    expect(TAG_WORDS).toContain(await card.locator('.tag').innerText());
  });

  test('Coming in says the tags are a quick first guess from a small model', async ({ page }) => {
    await open(page);
    await expect(page.locator('#incoming .col-note')).toHaveText('Tags are a quick first guess from a small model.');
  });

  test('the review form names where each default came from', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await runUntilOpen(page, 'T-1001-3');
    await reviewButton(page, 'T-1001-3').click();
    // The model picked Low for T-1001-3; a rule raised it to Urgent, shown as Critical.
    await expect(page.getByLabel('Priority').locator('option:checked')).toHaveText('Critical (raised by a rule)');
    await expect(page.getByLabel('Category').locator('option:checked')).toHaveText("Other (model's pick)");
  });

  test('the review form calls the model\'s own priority its pick when no rule raised it', async ({ page }) => {
    await playToFirstOpen(page);
    await reviewButton(page, 'T-1001-0').click();
    await expect(page.getByLabel('Priority').locator('option:checked')).toHaveText("Medium (model's pick)");
  });

  test('an open card shows its category, tag, team and reason', async ({ page }) => {
    await playToFirstOpen(page);
    const card = page.locator('#outgoing .open li', { hasText: 'T-1001-0' });
    await expect(card.locator('.card-title')).toHaveText('T-1001-0 Billing');
    await expect(card.locator('.tag')).toHaveText('Medium');
    await expect(card.locator('.card-team')).toHaveText('Billing Team');
    await expect(card.locator('.card-line')).toHaveText('the model is not sure enough');
  });
});

test.describe('a review the viewer confirms', () => {
  // The true answer for T-1001-0 is Billing and Medium, and the model's own picks are the same.
  const cases = [
    { name: 'the model picks', category: 'Billing', priority: 'Medium', correct: '1 of 1' },
    { name: 'a wrong category', category: 'Account Access', priority: 'Medium', correct: '0 of 1' },
    { name: 'a wrong priority', category: 'Billing', priority: 'High', correct: '0 of 1' },
  ];
  for (const { name, category, priority, correct } of cases) {
    test(`with ${name}: the closed line shows the choice and the score follows`, async ({ page }) => {
      await playToFirstOpen(page);
      await reviewButton(page, 'T-1001-0').click();
      await page.getByLabel('Category').selectOption(category);
      await page.getByLabel('Priority').selectOption(priority);
      await page.getByRole('button', { name: 'Confirm' }).click();
      const line = page.locator('#outgoing .closed li', { hasText: 'T-1001-0' });
      await expect(line.locator('.line-title')).toHaveText(`T-1001-0 ${category}`);
      await expect(line.locator('.pill')).toHaveText('You');
      await page.getByRole('button', { name: 'All numbers' }).click();
      await expect(moreNumber(page, 'Your reviews correct')).toHaveText(correct);
    });
  }
});

test.describe('the center', () => {
  test('shows the ticket text, marks what was masked and found, and tracks the stage', async ({ page }) => {
    // T-1001-2 is the third ticket to reach the center, and its text holds a card number.
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(FIRST_OPEN_MS);
    await page.getByRole('button', { name: 'Pause' }).click();
    expect(await centerId(page)).toBe('T-1001-2');
    await stepTo(page, 'Privacy');
    await expect(page.locator('#ticket .ticket-text')).toContainText('Three weeks ago I asked for a corretced receipt');
    await expect(page.locator('#ticket .ticket-text .mask')).toHaveText('[CARD_NUMBER]');
    await expect(page.locator('#ticket .ticket-text .chip')).toHaveCount(0);
    await stepTo(page, 'Classify');
    expect(await page.locator('#ticket .ticket-text .chip').count()).toBeGreaterThan(0);
    await expect(page.locator('#ticket .step')).toHaveCount(6);
    await expect(page.locator('#ticket .step-done')).toHaveCount(2);
    await expect(page.locator('#ticket .step-now .step-name')).toHaveText('Classify');
    await expect(page.locator('#ticket .step-now')).toHaveAttribute('aria-current', 'step');
  });

  test('marks the step after Guardrails as next, in words, and not as the current one', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Step' }).click();
    await stepTo(page, 'Classify');
    await expect(page.locator('#ticket .step-next')).toHaveCount(0);
    await stepTo(page, 'Guardrails');
    await expect(page.locator('#ticket .step-now .step-name')).toHaveText('Guardrails');
    await expect(page.locator('#ticket .step-next .step-name')).toHaveText(
      /^Next: (Review by a person|Done, no review needed)$/,
    );
    await expect(page.locator('#ticket .step-next')).not.toHaveAttribute('aria-current', 'step');
  });

  test('words the center tag as a first guess, and the Classify row uses the same priority words', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(FIRST_TAG_MS);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.locator('#ticket .now .tag')).toHaveText(/^First guess: (Critical|High|Medium|Low)$/);
    await stepTo(page, 'Classify');
    await expect(page.locator('#ticket .line-detail').nth(1)).not.toContainText('Urgent');
    await expect(page.locator('#ticket .line-detail').nth(1)).toContainText(/Priority (Critical|High|Medium|Low),/);
  });

  test('the review form shows the ticket text, the masked part and the reason', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    await runUntilOpen(page, 'T-1001-2');
    await reviewButton(page, 'T-1001-2').click();
    await expect(page.locator('#review .ticket-text')).toContainText('Our auditors are waiting on me');
    await expect(page.locator('#review .ticket-text .mask')).toHaveText('[CARD_NUMBER]');
    await expect(page.locator('#review .why')).toHaveText(
      'Why it was flagged: Security Concern tickets always go to a person, and the model is not sure enough.',
    );
  });

  test('the loading line goes away once the model is in', async ({ page }) => {
    await open(page, `?seed=${SEED}`);
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#app')).toBeVisible();
  });
});
